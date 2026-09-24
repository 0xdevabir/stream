import { timingSafeEqual } from "node:crypto";

import { streamIdFromMediamtxPath } from "@stream/shared";
import { hashStreamKey, prisma } from "@stream/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { playbackTokenFrom } from "../auth/cookies";
import { verifyPlaybackToken, verifyPublishToken } from "../auth/tokens";
import { env } from "../env";
import { ApiError } from "../errors";
import { getContentKeyForStream } from "../services/content-keys";
import * as events from "../services/events";
import { isPlaybackSessionActive } from "../services/playback";
import * as presence from "../services/presence";
import * as streams from "../services/streams";
import * as webhooks from "../services/webhooks";
import * as validate from "../validate";

/**
 * The service-to-service control plane: MediaMTX's authorization hook, nginx's
 * auth_request endpoint, and the transcoder's reporting.
 *
 * Everything here is authenticated with INTERNAL_TOKEN rather than a user
 * session, and the edge returns 404 for /internal/* so none of it is reachable
 * from outside the compose network. Both layers matter: the shared secret is
 * what actually protects these routes if the network boundary ever fails.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireInternalToken(request: FastifyRequest): void {
  const header = request.headers["x-internal-token"];
  if (typeof header !== "string" || !constantTimeEquals(header, env.INTERNAL_TOKEN)) {
    throw ApiError.unauthorized("Invalid internal token");
  }
}

/** MediaMTX posts this shape to `authHTTPAddress` before every action. */
const mediamtxAuthSchema = z.object({
  user: z.string().default(""),
  password: z.string().default(""),
  token: z.string().default(""),
  ip: z.string().default(""),
  action: z.string(),
  path: z.string().default(""),
  protocol: z.string().default(""),
  id: z.string().default(""),
  query: z.string().default(""),
});

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // ── MediaMTX authorization ───────────────────────────────────────────────

  /**
   * Called by MediaMTX before every publish and every read.
   *
   * 2xx allows, anything else denies. This is what stops a stranger who
   * guesses a stream id from either hijacking an ingest or pulling the raw
   * unencrypted feed over WebRTC.
   */
  app.post("/mediamtx/auth", async (request, reply) => {
    const payload = validate.body(mediamtxAuthSchema, request);
    const streamId = streamIdFromMediamtxPath(payload.path);

    if (!streamId) {
      request.log.warn({ path: payload.path }, "mediamtx: unrecognised path");
      return reply.code(403).send({ error: "unknown path" });
    }

    // Credentials arrive differently per protocol: RTMP puts them in the
    // stream key's query string, SRT in the streamid's user/pass fields, and
    // WHIP in an Authorization header MediaMTX surfaces as `token`.
    const query = new URLSearchParams(payload.query);
    const presented = [
      query.get("key"),
      query.get("token"),
      payload.token,
      payload.password,
    ].filter((value): value is string => !!value && value.length > 0);

    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        status: true,
        streamKeyHash: true,
        organizationId: true,
        instructorId: true,
        courseId: true,
        accessMode: true,
        passwordHash: true,
        shareToken: true,
        latencyMode: true,
      },
    });

    if (!stream) return reply.code(403).send({ error: "unknown stream" });

    if (payload.action === "publish") {
      // Only a cancelled class is permanently closed. An ENDED one is
      // deliberately still publishable: the instructor may be resuming after a
      // dropped connection, or running a second session of the same class.
      // Refusing here used to make any blip unrecoverable -- the class ended,
      // and every reconnect attempt was then rejected as "not open".
      // `beginLive` clears `endedAt` and returns it to LIVE.
      if (stream.status === "CANCELLED") {
        return reply.code(403).send({ error: "class is cancelled" });
      }

      for (const credential of presented) {
        // OBS / SRT / hardware encoders: the long-lived stream key.
        if (constantTimeEquals(hashStreamKey(credential), stream.streamKeyHash)) {
          return reply.code(204).send();
        }
        // Browser "Go Live": a short-lived publish token, so the instructor's
        // machine never has to hold the real key.
        const publish = await verifyPublishToken(credential);
        if (publish && publish.streamId === streamId) {
          return reply.code(204).send();
        }
      }

      request.log.warn(
        { streamId, protocol: payload.protocol },
        "mediamtx: rejected publish",
      );
      return reply.code(403).send({ error: "invalid stream key" });
    }

    if (payload.action === "read") {
      // The transcoder pulling the source back out over RTSP.
      if (
        payload.user === "internal" &&
        constantTimeEquals(payload.password, env.INTERNAL_TOKEN)
      ) {
        return reply.code(204).send();
      }

      // A WHEP viewer. Only offered for classes that opted into ULTRA mode.
      if (stream.latencyMode !== "ULTRA") {
        return reply.code(403).send({ error: "webrtc playback is disabled" });
      }

      for (const credential of presented) {
        const claims = await verifyPlaybackToken(credential);
        if (
          claims &&
          claims.streamId === streamId &&
          (await isPlaybackSessionActive(claims.jti))
        ) {
          return reply.code(204).send();
        }
      }

      return reply.code(403).send({ error: "no valid playback session" });
    }

    return reply.code(403).send({ error: "unsupported action" });
  });

  // ── nginx auth_request ───────────────────────────────────────────────────

  /**
   * Authorizes one media request. nginx caches the answer per
   * (playback cookie, stream) for a few seconds, so this runs a handful of
   * times per second for a class of any size rather than once per segment.
   *
   * Returns 204 to allow. The body is never read by nginx.
   */
  app.get("/edge/authz", async (request, reply) => {
    requireInternalToken(request);

    const scope = request.headers["x-media-scope"];
    if (typeof scope !== "string" || scope.length === 0) {
      return reply.code(403).send();
    }

    const [kind, resourceId] = scope.split(":", 2);
    if (!kind || !resourceId) return reply.code(403).send();

    const token = playbackTokenFrom(request);
    if (!token) return reply.code(401).send();

    const claims = await verifyPlaybackToken(token);
    if (!claims) return reply.code(401).send();

    if (!(await isPlaybackSessionActive(claims.jti))) {
      return reply.code(401).send();
    }

    if (kind === "live") {
      // The grant must be for this exact class.
      if (claims.streamId !== resourceId) return reply.code(403).send();
      return reply.code(204).send();
    }

    if (kind === "vod") {
      // A recording is watchable by anyone holding a valid grant for the class
      // it came from, which lets a student who joined the live session replay
      // it later without re-authorizing.
      const recording = await prisma.recording.findUnique({
        where: { id: resourceId },
        select: { streamId: true, status: true },
      });

      if (!recording || recording.status !== "READY") {
        return reply.code(404).send();
      }
      if (recording.streamId !== claims.streamId) {
        return reply.code(403).send();
      }
      return reply.code(204).send();
    }

    return reply.code(403).send();
  });

  // ── Transcoder control plane ─────────────────────────────────────────────

  const streamIdParam = z.object({ id: z.string().min(1).max(128) });

  /**
   * Everything the transcoder needs to start encoding a class it has just
   * seen appear on MediaMTX. The AES key is returned in the clear over the
   * internal network: the transcoder has to hand it to ffmpeg, so there is
   * nowhere else for it to come from.
   */
  app.get("/streams/:id/encode-config", async (request) => {
    requireInternalToken(request);
    const { id } = validate.params(streamIdParam, request);

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        recordEnabled: true,
        latencyMode: true,
        title: true,
      },
    });
    if (!stream) throw ApiError.notFound("Unknown stream");

    const contentKey = await getContentKeyForStream(stream.id);
    if (!contentKey) throw ApiError.notFound("Unknown stream");

    return {
      streamId: stream.id,
      title: stream.title,
      recordEnabled: stream.recordEnabled,
      latencyMode: stream.latencyMode,
      contentKeyId: contentKey.keyId,
      contentKeyHex: contentKey.key.toString("hex"),
      ladder: streams.ladder.map((rendition) => rendition.name),
    };
  });

  /** Media has started arriving. */
  app.post("/streams/:id/live", async (request, reply) => {
    requireInternalToken(request);
    const { id } = validate.params(streamIdParam, request);

    const wentLive = await streams.beginLive(id);
    const stream = await streams.findStreamBySlugOrId(id);
    if (stream) {
      // Only on a real transition: the transcoder re-reports after an encoder
      // reconnect, and customers should see one stream.live per session.
      if (wentLive) {
        await webhooks.emit(
          stream.organizationId,
          "stream.live",
          {
            stream: webhookStream(stream),
            hlsUrl: absoluteUrl(urls(stream).hlsUrl),
          },
          request.log,
        );
      }
      // Viewers already sitting on the pre-live page start playing without a
      // refresh.
      await events.publish(id, {
        t: "status",
        status: "LIVE",
        hlsUrl: urls(stream).hlsUrl,
      });
    }

    return reply.code(204).send();
  });

  /** Media has stopped. A recording may follow. */
  app.post("/streams/:id/offline", async (request, reply) => {
    requireInternalToken(request);
    const { id } = validate.params(streamIdParam, request);

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: WEBHOOK_STREAM_SELECT,
    });
    if (!stream) throw ApiError.notFound("Unknown stream");

    await streams.beginProcessing(id, stream.recordEnabled);
    await webhooks.emit(
      stream.organizationId,
      "stream.ended",
      {
        stream: webhookStream({
          ...stream,
          status: stream.recordEnabled ? "PROCESSING" : "ENDED",
        }),
        recordingExpected: stream.recordEnabled,
      },
      request.log,
    );
    await events.publish(id, {
      t: "status",
      status: stream.recordEnabled ? "PROCESSING" : "ENDED",
      hlsUrl: null,
    });

    return reply.code(204).send();
  });

  /** Periodic report so peak-viewer stats survive an API restart. */
  app.post("/streams/:id/heartbeat", async (request, reply) => {
    requireInternalToken(request);
    const { id } = validate.params(streamIdParam, request);

    const current = await presence.count(id);
    await streams.recordViewerPeak(id, current);

    return reply.code(200).send({ viewers: current });
  });

  // ── Recording lifecycle ──────────────────────────────────────────────────

  const recordingStartSchema = z.object({ streamId: z.string().min(1) });

  app.post("/recordings/start", async (request) => {
    requireInternalToken(request);
    const input = validate.body(recordingStartSchema, request);

    const recording = await prisma.recording.create({
      data: { streamId: input.streamId, status: "PROCESSING" },
    });

    return { recordingId: recording.id };
  });

  const recordingCompleteSchema = z.object({
    recordingId: z.string().min(1),
    status: z.enum(["READY", "FAILED"]),
    durationSeconds: z.number().nonnegative().optional(),
    sizeBytes: z.number().nonnegative().optional(),
    segmentCount: z.number().int().nonnegative().optional(),
    renditions: z.array(z.string()).optional(),
    storagePrefix: z.string().optional(),
    posterKey: z.string().optional(),
    downloadKey: z.string().optional(),
    error: z.string().max(2000).optional(),
  });

  app.post("/recordings/complete", async (request, reply) => {
    requireInternalToken(request);
    const input = validate.body(recordingCompleteSchema, request);

    const recording = await prisma.recording.update({
      where: { id: input.recordingId },
      data: {
        status: input.status,
        durationSeconds: input.durationSeconds ?? null,
        sizeBytes:
          input.sizeBytes !== undefined ? BigInt(Math.round(input.sizeBytes)) : null,
        segmentCount: input.segmentCount ?? 0,
        renditions: input.renditions ?? [],
        storagePrefix: input.storagePrefix ?? null,
        posterKey: input.posterKey ?? null,
        downloadKey: input.downloadKey ?? null,
        error: input.error ?? null,
        readyAt: input.status === "READY" ? new Date() : null,
      },
      select: {
        id: true,
        streamId: true,
        durationSeconds: true,
        stream: { select: WEBHOOK_STREAM_SELECT },
      },
    });

    // The class is only truly over once its replay exists (or has failed).
    await streams.markEnded(recording.streamId);
    await webhooks.emit(
      recording.stream.organizationId,
      input.status === "READY" ? "recording.ready" : "recording.failed",
      {
        stream: webhookStream({ ...recording.stream, status: "ENDED" }),
        recording: {
          id: recording.id,
          status: input.status,
          durationSeconds: recording.durationSeconds,
          ...(input.status === "READY"
            ? { vodUrl: absoluteUrl(streams.recordingUrl(recording.id)) }
            : { error: input.error ?? null }),
        },
      },
      request.log,
    );
    await events.publish(recording.streamId, {
      t: "status",
      status: "ENDED",
      hlsUrl: null,
    });

    return reply.code(204).send();
  });
}

// ── Webhook payloads ─────────────────────────────────────────────────────────

const WEBHOOK_STREAM_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  organizationId: true,
  recordEnabled: true,
  latencyMode: true,
} as const;

/** The stable, documented shape of `data.stream` in every webhook event. */
function webhookStream(stream: {
  id: string;
  slug: string;
  title: string;
  status: string;
}) {
  return { id: stream.id, slug: stream.slug, title: stream.title, status: stream.status };
}

function urls(stream: { id: string; status: string; latencyMode: string }) {
  return streams.playbackUrls({ ...stream, status: "LIVE" });
}

/** Webhook receivers are off-site, so relative edge paths are made absolute. */
function absoluteUrl(path: string | null): string | null {
  return path ? new URL(path, env.PUBLIC_BASE_URL).toString() : null;
}
