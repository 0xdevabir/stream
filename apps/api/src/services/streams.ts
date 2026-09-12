import {
  type CreateStreamInput,
  type StreamSummary,
  type UpdateStreamInput,
  liveMasterUrl,
  parseLadder,
  vodMasterUrl,
  whepUrl,
} from "@stream/shared";
import {
  type Prisma,
  type Stream,
  generateContentKeyId,
  generateContentKey,
  generateShareToken,
  generateStreamKey,
  hashPassword,
  hashStreamKey,
  prisma,
  slugify,
  streamKeyPrefix,
  unwrapSecret,
  wrapContentKey,
  wrapSecret,
} from "@stream/db";

import { env } from "../env";
import { ApiError } from "../errors";
import * as presence from "./presence";

/**
 * Stream lifecycle and serialization.
 *
 * SCHEDULED -> LIVE -> PROCESSING -> ENDED is driven by the media plane, not
 * by the instructor clicking buttons: the transcoder reports when media
 * actually starts and stops arriving. That way a dropped connection and a
 * deliberate "end class" converge on the same state, and a browser crash
 * mid-lecture still produces a recording.
 */

const STREAM_INCLUDE = {
  instructor: { select: { id: true, name: true, avatarUrl: true } },
  recordings: {
    where: { status: "READY" as const },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.StreamInclude;

type StreamWithRelations = Prisma.StreamGetPayload<{
  include: typeof STREAM_INCLUDE;
}>;

export const ladder = parseLadder(env.LADDER);

export function serializeStream(
  stream: StreamWithRelations,
  viewerCount: number,
): StreamSummary {
  const recordingId = stream.recordings[0]?.id ?? null;

  return {
    id: stream.id,
    slug: stream.slug,
    title: stream.title,
    description: stream.description,
    status: stream.status,
    accessMode: stream.accessMode,
    latencyMode: stream.latencyMode,
    scheduledAt: stream.scheduledAt?.toISOString() ?? null,
    startedAt: stream.startedAt?.toISOString() ?? null,
    endedAt: stream.endedAt?.toISOString() ?? null,
    posterUrl: stream.posterUrl,
    recordEnabled: stream.recordEnabled,
    chatEnabled: stream.chatEnabled,
    questionsEnabled: stream.questionsEnabled,
    viewerCount,
    instructor: stream.instructor,
    recordingId,
  };
}

export async function findStreamBySlugOrId(
  idOrSlug: string,
): Promise<StreamWithRelations | null> {
  // Slugs are what appear in URLs; ids are what the API and media plane use.
  return prisma.stream.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: STREAM_INCLUDE,
  });
}

export async function requireStream(
  idOrSlug: string,
): Promise<StreamWithRelations> {
  const stream = await findStreamBySlugOrId(idOrSlug);
  if (!stream) throw ApiError.notFound("Class not found");
  return stream;
}

// ── Creation and editing ───────────────────────────────────────────────────

export interface CreatedStream {
  stream: StreamWithRelations;
  /** Shown to the instructor exactly once; only its hash is stored. */
  streamKey: string;
}

export async function createStream(
  organizationId: string,
  instructorId: string,
  input: CreateStreamInput,
): Promise<CreatedStream> {
  const streamKey = generateStreamKey();
  const contentKey = generateContentKey();

  const stream = await prisma.stream.create({
    data: {
      organizationId,
      instructorId,
      courseId: input.courseId ?? null,
      slug: slugify(input.title),
      title: input.title,
      description: input.description ?? null,
      scheduledAt: input.scheduledAt ?? null,
      accessMode: input.accessMode,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      latencyMode: input.latencyMode,
      recordEnabled: input.recordEnabled,
      chatEnabled: input.chatEnabled,
      questionsEnabled: input.questionsEnabled,
      shareToken: generateShareToken(),
      streamKeyHash: hashStreamKey(streamKey),
      streamKeyWrapped: wrapSecret(streamKey, env.CONTENT_KEY_SECRET),
      streamKeyPrefix: streamKeyPrefix(streamKey),
      contentKeyId: generateContentKeyId(),
      contentKeyWrapped: wrapContentKey(contentKey, env.CONTENT_KEY_SECRET),
    },
    include: STREAM_INCLUDE,
  });

  return { stream, streamKey };
}

export async function updateStream(
  streamId: string,
  input: UpdateStreamInput,
): Promise<StreamWithRelations> {
  const data: Prisma.StreamUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.courseId !== undefined) {
    data.course = input.courseId
      ? { connect: { id: input.courseId } }
      : { disconnect: true };
  }
  if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;
  if (input.accessMode !== undefined) data.accessMode = input.accessMode;
  if (input.latencyMode !== undefined) data.latencyMode = input.latencyMode;
  if (input.recordEnabled !== undefined) data.recordEnabled = input.recordEnabled;
  if (input.chatEnabled !== undefined) data.chatEnabled = input.chatEnabled;
  if (input.questionsEnabled !== undefined) {
    data.questionsEnabled = input.questionsEnabled;
  }

  if (input.password) {
    data.passwordHash = await hashPassword(input.password);
  } else if (input.removePassword) {
    data.passwordHash = null;
  }

  // A PASSWORD-mode class with no password would be open to the world, so
  // reject the combination rather than silently falling back.
  const target = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { accessMode: true, passwordHash: true },
  });
  if (!target) throw ApiError.notFound("Class not found");

  const finalMode = input.accessMode ?? target.accessMode;
  const willHavePassword =
    data.passwordHash !== null &&
    (data.passwordHash !== undefined || target.passwordHash !== null);

  if (finalMode === "PASSWORD" && !willHavePassword) {
    throw ApiError.badRequest(
      "A password is required to use PASSWORD access mode",
    );
  }

  return prisma.stream.update({
    where: { id: streamId },
    data,
    include: STREAM_INCLUDE,
  });
}

/**
 * Issues a fresh ingest credential and invalidates the old one. Used when a
 * key may have leaked, or when an instructor wants to lock out a stale OBS
 * profile.
 */
export async function rotateStreamKey(streamId: string): Promise<string> {
  const streamKey = generateStreamKey();
  await prisma.stream.update({
    where: { id: streamId },
    data: {
      streamKeyHash: hashStreamKey(streamKey),
      streamKeyWrapped: wrapSecret(streamKey, env.CONTENT_KEY_SECRET),
      streamKeyPrefix: streamKeyPrefix(streamKey),
      streamKeyRotatedAt: new Date(),
    },
  });
  return streamKey;
}

/**
 * Recovers the plaintext ingest key so the OBS panel can show it again.
 * Restricted to the instructor and org admins by the calling route.
 */
export async function revealStreamKey(streamId: string): Promise<string> {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { streamKeyWrapped: true },
  });
  if (!stream) throw ApiError.notFound("Class not found");

  return unwrapSecret(
    Buffer.from(stream.streamKeyWrapped),
    env.CONTENT_KEY_SECRET,
  );
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

/**
 * Called when media starts arriving. `startedAt` is written only on the first
 * transition, so a brief encoder reconnect mid-class does not reset the clock
 * the recording and analytics are measured against.
 */
export async function beginLive(streamId: string): Promise<void> {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { startedAt: true },
  });

  await prisma.stream.update({
    where: { id: streamId },
    data: {
      status: "LIVE",
      endedAt: null,
      ...(stream?.startedAt ? {} : { startedAt: new Date() }),
    },
  });
}

/** Media stopped; a recording may still be processing. */
export async function beginProcessing(
  streamId: string,
  willRecord: boolean,
): Promise<void> {
  await prisma.stream.update({
    where: { id: streamId },
    data: {
      status: willRecord ? "PROCESSING" : "ENDED",
      endedAt: new Date(),
    },
  });
  await presence.clear(streamId);
}

export async function markEnded(streamId: string): Promise<void> {
  await prisma.stream.update({
    where: { id: streamId },
    data: { status: "ENDED" },
  });
}

/** Keeps a high-water mark for the post-class analytics panel. */
export async function recordViewerPeak(
  streamId: string,
  current: number,
): Promise<void> {
  await prisma.stream.updateMany({
    where: { id: streamId, peakViewers: { lt: current } },
    data: { peakViewers: current },
  });
}

// ── URLs handed to clients ────────────────────────────────────────────────

export function playbackUrls(stream: {
  id: string;
  status: string;
  latencyMode: string;
}): { hlsUrl: string | null; whepUrl: string | null } {
  if (stream.status !== "LIVE") return { hlsUrl: null, whepUrl: null };

  return {
    hlsUrl: liveMasterUrl(stream.id),
    // The sub-second path is only advertised when the class opted into it:
    // every WHEP viewer is a live peer connection on the server, which does
    // not have the near-zero marginal cost that HLS segments do.
    whepUrl: stream.latencyMode === "ULTRA" ? whepUrl(stream.id) : null,
  };
}

export function recordingUrl(recordingId: string | null): string | null {
  return recordingId ? vodMasterUrl(recordingId) : null;
}

/**
 * Ingest credentials for instructors who use OBS or a hardware encoder.
 *
 * The stream id goes in the path and the secret in the query string, which is
 * how both OBS ("stream key" field) and MediaMTX's path+query split expect it.
 */
export function ingestCredentials(streamId: string, streamKey: string) {
  return {
    rtmp: {
      url: env.INGEST_RTMP_URL,
      streamKey: `${streamId}?key=${streamKey}`,
    },
    srt: {
      url:
        `srt://${env.INGEST_SRT_HOST}:${env.INGEST_SRT_PORT}` +
        `?streamid=publish:live/${streamId}:${streamId}:${streamKey}`,
    },
  };
}

// ── Listing ───────────────────────────────────────────────────────────────

export interface ListOptions {
  organizationId: string;
  viewerId: string | null;
  status?: string | undefined;
  courseId?: string | undefined;
  mine?: boolean | undefined;
  limit: number;
  cursor?: string | undefined;
}

export async function listStreams(options: ListOptions): Promise<{
  items: StreamSummary[];
  nextCursor: string | null;
}> {
  const where: Prisma.StreamWhereInput = {
    organizationId: options.organizationId,
    ...(options.status ? { status: options.status as Stream["status"] } : {}),
    ...(options.courseId ? { courseId: options.courseId } : {}),
    ...(options.mine && options.viewerId
      ? { instructorId: options.viewerId }
      : {}),
  };

  const rows = await prisma.stream.findMany({
    where,
    include: STREAM_INCLUDE,
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const counts = await presence.countMany(page.map((row) => row.id));

  return {
    items: page.map((row) => serializeStream(row, counts.get(row.id) ?? 0)),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}
