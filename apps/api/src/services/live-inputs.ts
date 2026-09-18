import {
  type CreateLiveInput,
  type LiveInput,
  type PlaybackTokenResponse,
  type ProviderVideo,
  liveMasterUrl,
  vodMasterUrl,
  whipUrl,
} from "@stream/shared";
import {
  generateContentKey,
  generateContentKeyId,
  generateShareToken,
  generateStreamKey,
  hashStreamKey,
  prisma,
  slugify,
  streamKeyPrefix,
  unwrapSecret,
  wrapContentKey,
  wrapSecret,
} from "@stream/db";

import { signPlaybackToken } from "../auth/tokens";
import { env } from "../env";
import { ApiError } from "../errors";
import { playbackSessionKey, redis } from "../redis";
import type { TenantContext } from "./tenants";
import * as usage from "./usage";

function mediaBase(): string {
  return env.CDN_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL;
}

function absolute(path: string | null): string | null {
  if (!path) return null;
  return new URL(path, mediaBase()).toString();
}

function withToken(url: string | null, token: string): string | null {
  if (!url) return null;
  const parsed = new URL(url);
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

export async function createLiveInput(
  ctx: TenantContext,
  input: CreateLiveInput,
): Promise<{ liveInput: LiveInput; streamKey: string }> {
  const concurrent = await usage.countConcurrentLives(ctx.tenantId);
  if (concurrent >= ctx.maxConcurrentLives) {
    throw ApiError.tooManyRequests(
      `Concurrent live input limit reached (${ctx.maxConcurrentLives})`,
    );
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { liveMinutes } = await usage.summarizeUsage(ctx.tenantId, monthStart);
  if (liveMinutes >= ctx.maxMinutesPerMonth) {
    throw ApiError.tooManyRequests(
      `Monthly live-minute quota exhausted (${ctx.maxMinutesPerMonth})`,
    );
  }

  const streamKey = generateStreamKey();
  const contentKey = generateContentKey();

  const stream = await prisma.stream.create({
    data: {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      instructorId: ctx.serviceUserId,
      slug: slugify(input.name),
      title: input.name,
      description: input.metadata
        ? JSON.stringify(input.metadata).slice(0, 5000)
        : null,
      accessMode: "PUBLIC",
      latencyMode: "LOW",
      recordEnabled: input.record,
      chatEnabled: false,
      questionsEnabled: false,
      shareToken: generateShareToken(),
      streamKeyHash: hashStreamKey(streamKey),
      streamKeyWrapped: wrapSecret(streamKey, env.CONTENT_KEY_SECRET),
      streamKeyPrefix: streamKeyPrefix(streamKey),
      contentKeyId: generateContentKeyId(),
      contentKeyWrapped: wrapContentKey(contentKey, env.CONTENT_KEY_SECRET),
    },
    include: {
      recordings: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  return {
    liveInput: serializeLiveInput(stream, streamKey),
    streamKey,
  };
}

export async function getLiveInput(
  ctx: TenantContext,
  id: string,
): Promise<LiveInput> {
  const stream = await requireTenantStream(ctx.tenantId, id);
  const streamKey = unwrapSecret(
    Buffer.from(stream.streamKeyWrapped),
    env.CONTENT_KEY_SECRET,
  );
  return serializeLiveInput(stream, streamKey);
}

export async function deleteLiveInput(
  ctx: TenantContext,
  id: string,
): Promise<void> {
  const stream = await requireTenantStream(ctx.tenantId, id);
  await prisma.stream.update({
    where: { id: stream.id },
    data: { status: "CANCELLED", endedAt: new Date() },
  });
}

export async function mintPlaybackToken(
  ctx: TenantContext,
  id: string,
  options: { ttlSeconds?: number },
): Promise<PlaybackTokenResponse> {
  const stream = await requireTenantStream(ctx.tenantId, id);
  if (stream.status === "CANCELLED") {
    throw ApiError.notFound("Live input was cancelled");
  }

  const recordingId = stream.recordings[0]?.id ?? null;
  const scope = stream.status === "ENDED" && recordingId ? "vod" : "live";
  const ttl = Math.min(Math.max(options.ttlSeconds ?? env.PLAYBACK_TOKEN_TTL, 60), 86_400);

  const { token, jti, expiresAt } = await signPlaybackToken({
    userId: null,
    streamId: stream.id,
    scope,
    ttlSeconds: ttl,
    ...(recordingId ? { recordingId } : {}),
  });

  await redis.set(
    playbackSessionKey(jti),
    JSON.stringify({
      streamId: stream.id,
      userId: null,
      scope,
      ...(recordingId ? { recordingId } : {}),
      issuedAt: Date.now(),
      tenantId: ctx.tenantId,
    }),
    "EX",
    ttl,
  );

  await usage.recordUsage({
    tenantId: ctx.tenantId,
    streamId: stream.id,
    kind: "TOKEN_ISSUED",
    quantity: 1,
  });

  const hlsPath = stream.status === "LIVE" ? liveMasterUrl(stream.id) : null;
  const vodPath = recordingId ? vodMasterUrl(recordingId) : null;
  const hlsUrl = absolute(hlsPath);
  const vodUrl = absolute(vodPath);

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    hlsUrl,
    vodUrl,
    signedHlsUrl: withToken(hlsUrl, token),
    signedVodUrl: withToken(vodUrl, token),
  };
}

export async function getVideo(
  ctx: TenantContext,
  recordingId: string,
): Promise<ProviderVideo> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: {
      stream: { select: { id: true, tenantId: true } },
    },
  });

  if (!recording || recording.stream.tenantId !== ctx.tenantId) {
    throw ApiError.notFound("Video not found");
  }

  return {
    id: recording.id,
    liveInputId: recording.stream.id,
    status: recording.status,
    durationSeconds: recording.durationSeconds,
    sizeBytes: recording.sizeBytes ? Number(recording.sizeBytes) : null,
    vodUrl:
      recording.status === "READY" ? absolute(vodMasterUrl(recording.id)) : null,
    downloadUrl:
      recording.downloadKey && recording.status === "READY"
        ? absolute(`/vod/${recording.id}/download.mp4`)
        : null,
    createdAt: recording.createdAt.toISOString(),
    readyAt: recording.readyAt?.toISOString() ?? null,
  };
}

async function requireTenantStream(tenantId: string, id: string) {
  const stream = await prisma.stream.findFirst({
    where: { id, tenantId },
    include: {
      recordings: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!stream) throw ApiError.notFound("Live input not found");
  return stream;
}

function serializeLiveInput(
  stream: {
    id: string;
    title: string;
    status: LiveInput["status"];
    recordEnabled: boolean;
    createdAt: Date;
    startedAt: Date | null;
    endedAt: Date | null;
    recordings: Array<{ id: string }>;
  },
  streamKey: string,
): LiveInput {
  const recordingId = stream.recordings[0]?.id ?? null;
  return {
    id: stream.id,
    name: stream.title,
    status: stream.status,
    record: stream.recordEnabled,
    createdAt: stream.createdAt.toISOString(),
    startedAt: stream.startedAt?.toISOString() ?? null,
    endedAt: stream.endedAt?.toISOString() ?? null,
    ingest: {
      rtmp: {
        url: env.INGEST_RTMP_URL,
        streamKey: `${stream.id}?key=${streamKey}`,
      },
      srt: {
        url:
          `srt://${env.INGEST_SRT_HOST}:${env.INGEST_SRT_PORT}` +
          `?streamid=publish:live/${stream.id}:${stream.id}:${streamKey}`,
      },
      whip: {
        url: new URL(whipUrl(stream.id), env.PUBLIC_BASE_URL).toString(),
      },
    },
    playback: {
      hlsUrl:
        stream.status === "LIVE" ? absolute(liveMasterUrl(stream.id)) : null,
      vodUrl: recordingId ? absolute(vodMasterUrl(recordingId)) : null,
    },
    recordingId,
  };
}
