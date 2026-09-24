import {
  type EmbedToken,
  createEmbedTokenSchema,
  createStreamSchema,
  enrollUsersSchema,
  idSchema,
  listStreamsSchema,
  updateStreamSchema,
  whipUrl,
} from "@stream/shared";
import { prisma } from "@stream/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireRole } from "../auth/session";
import { signEmbedToken, signPublishToken } from "../auth/tokens";
import { env } from "../env";
import { ApiError } from "../errors";
import { canModerate } from "../services/access";
import * as events from "../services/events";
import * as mediamtx from "../services/mediamtx";
import * as playback from "../services/playback";
import * as presence from "../services/presence";
import * as streams from "../services/streams";
import * as validate from "../validate";

const idParam = z.object({ id: z.string().min(1).max(128) });

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Anything that mutates a class, or reveals its ingest credentials, must be
   * performed by its instructor or an org admin. Resolved once here rather
   * than re-derived in each handler.
   */
  async function requireControl(request: Parameters<typeof requireAuth>[0], id: string) {
    const auth = requireAuth(request);
    const stream = await streams.requireStream(id);

    if (
      !canModerate(stream, {
        userId: auth.userId,
        organizationId: auth.organizationId,
        role: auth.role,
      })
    ) {
      throw ApiError.forbidden("Only the instructor can manage this class");
    }

    return { auth, stream };
  }

  app.get("/", async (request) => {
    const auth = requireAuth(request);
    const input = validate.query(listStreamsSchema, request);

    return streams.listStreams({
      organizationId: auth.organizationId,
      viewerId: auth.userId,
      status: input.status,
      courseId: input.courseId,
      mine: input.mine,
      limit: input.limit,
      cursor: input.cursor,
    });
  });

  app.post("/", async (request, reply) => {
    const auth = requireRole(request, "INSTRUCTOR");
    const input = validate.body(createStreamSchema, request);

    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, organizationId: auth.organizationId },
        select: { id: true },
      });
      if (!course) throw ApiError.badRequest("That course does not exist");
    }

    const { stream, streamKey } = await streams.createStream(
      auth.organizationId,
      auth.userId,
      input,
    );

    return reply.code(201).send({
      stream: streams.serializeStream(stream, 0),
      // Returned once here so the create-class flow can show OBS setup
      // immediately; retrievable later via GET /:id/ingest.
      ingest: streams.ingestCredentials(stream.id, streamKey),
      shareToken: stream.shareToken,
    });
  });

  app.get("/:id", async (request) => {
    const auth = requireAuth(request);
    const { id } = validate.params(idParam, request);
    const stream = await streams.requireStream(id);

    if (stream.organizationId !== auth.organizationId) {
      // Cross-organization reads are simply "not found": confirming the class
      // exists would leak the titles of other tenants' lectures.
      throw ApiError.notFound("Class not found");
    }

    return {
      stream: streams.serializeStream(stream, await presence.count(stream.id)),
    };
  });

  app.patch("/:id", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);
    const input = validate.body(updateStreamSchema, request);

    const updated = await streams.updateStream(stream.id, input);
    return {
      stream: streams.serializeStream(updated, await presence.count(stream.id)),
    };
  });

  /** Cancels a class. Past classes are kept for their recordings. */
  app.delete("/:id", async (request, reply) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);

    if (stream.status === "LIVE") {
      throw ApiError.conflict("End the class before cancelling it");
    }

    await prisma.stream.update({
      where: { id: stream.id },
      data: { status: "CANCELLED" },
    });
    return reply.code(204).send();
  });

  // ── Ingest ───────────────────────────────────────────────────────────────

  /**
   * Everything the instructor needs to start broadcasting: a short-lived WHIP
   * token for the browser path, and the RTMP/SRT credentials for OBS.
   */
  app.get("/:id/ingest", async (request) => {
    const { id } = validate.params(idParam, request);
    const { auth, stream } = await requireControl(request, id);

    const streamKey = await streams.revealStreamKey(stream.id);
    const publish = await signPublishToken({
      userId: auth.userId,
      streamId: stream.id,
    });

    return {
      streamId: stream.id,
      whipUrl: whipUrl(stream.id),
      token: publish.token,
      expiresAt: publish.expiresAt.toISOString(),
      ...streams.ingestCredentials(stream.id, streamKey),
      ladder: streams.ladder.map((rendition) => rendition.name),
    };
  });

  /** Encoder connection, bitrate and audience; poll it every few seconds. */
  app.get("/:id/health", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);
    return streams.health(stream);
  });

  app.post("/:id/key/rotate", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);

    const streamKey = await streams.rotateStreamKey(stream.id);

    // An encoder still connected with the old key would keep publishing until
    // it happened to reconnect, which defeats the point of rotating.
    await mediamtx.kickPublisher(stream.id);

    return { ingest: streams.ingestCredentials(stream.id, streamKey) };
  });

  /**
   * Ends a live class by disconnecting the publisher. The transcoder still
   * finalizes the recording (and emits `stream.ended`) once its grace window
   * runs out, but an explicit end is not a dropped connection: viewers are
   * told right away instead of watching a frozen frame for that window.
   */
  app.post("/:id/end", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);

    await mediamtx.kickPublisher(stream.id);
    if (stream.status === "LIVE") {
      await streams.beginProcessing(stream.id, stream.recordEnabled);
      await events.publish(stream.id, {
        t: "status",
        status: stream.recordEnabled ? "PROCESSING" : "ENDED",
        hlsUrl: null,
      });
    }

    return { ended: true };
  });

  // ── Enrollment ───────────────────────────────────────────────────────────

  app.get("/:id/enrollments", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);

    const rows = await prisma.enrollment.findMany({
      where: { streamId: stream.id },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return { enrollments: rows.map((row) => row.user) };
  });

  app.post("/:id/enrollments", async (request) => {
    const { id } = validate.params(idParam, request);
    const { auth, stream } = await requireControl(request, id);
    const input = validate.body(enrollUsersSchema, request);

    // Only users who already belong to this organization can be enrolled by
    // id; unknown addresses become invitations instead.
    const byId = await prisma.user.findMany({
      where: {
        id: { in: input.userIds },
        memberships: { some: { organizationId: auth.organizationId } },
      },
      select: { id: true },
    });

    const byEmail = await prisma.user.findMany({
      where: {
        email: { in: input.emails },
        memberships: { some: { organizationId: auth.organizationId } },
      },
      select: { id: true, email: true },
    });

    const userIds = [
      ...new Set([...byId.map((u) => u.id), ...byEmail.map((u) => u.id)]),
    ];

    if (userIds.length > 0) {
      await prisma.enrollment.createMany({
        data: userIds.map((userId) => ({ userId, streamId: stream.id })),
        skipDuplicates: true,
      });
    }

    const known = new Set(byEmail.map((u) => u.email));
    const unknown = input.emails.filter((email) => !known.has(email));

    return {
      enrolled: userIds.length,
      /** Addresses with no account yet; the UI offers to invite them. */
      unknownEmails: unknown,
    };
  });

  app.delete("/:id/enrollments/:userId", async (request, reply) => {
    const { id, userId } = validate.params(
      idParam.extend({ userId: idSchema }),
      request,
    );
    const { stream } = await requireControl(request, id);

    await prisma.enrollment.deleteMany({
      where: { streamId: stream.id, userId },
    });

    // Removing a student mid-class must take effect immediately, not when
    // their playback token happens to expire.
    await playback.revokeUserSessions(userId, stream.id);

    return reply.code(204).send();
  });

  // ── Embedding ────────────────────────────────────────────────────────────

  /**
   * Called by a customer's backend (API key) once it has decided one of its
   * own users may watch. The token replaces our access check entirely, so
   * this sits behind the same control check as editing the class.
   */
  app.post("/:id/embed-tokens", async (request) => {
    const { id } = validate.params(idParam, request);
    const input = validate.body(createEmbedTokenSchema, request);
    const { stream } = await requireControl(request, id);

    const { token, expiresAt } = await signEmbedToken(
      { streamId: stream.id, organizationId: stream.organizationId },
      input.ttlSeconds,
    );
    const embedUrl = new URL(`/embed/${encodeURIComponent(stream.slug)}`, env.PUBLIC_BASE_URL);
    embedUrl.searchParams.set("token", token);

    const result: EmbedToken = {
      token,
      expiresAt: expiresAt.toISOString(),
      embedUrl: embedUrl.toString(),
    };
    return result;
  });

  // ── Analytics ────────────────────────────────────────────────────────────

  app.get("/:id/analytics", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream } = await requireControl(request, id);

    const [sessions, uniqueViewers, messages, questions, current] =
      await Promise.all([
        prisma.viewerSession.count({ where: { streamId: stream.id } }),
        prisma.viewerSession
          .findMany({
            where: { streamId: stream.id, userId: { not: null } },
            distinct: ["userId"],
            select: { userId: true },
          })
          .then((rows) => rows.length),
        prisma.chatMessage.count({
          where: { streamId: stream.id, kind: "CHAT", deletedAt: null },
        }),
        prisma.chatMessage.count({
          where: { streamId: stream.id, kind: "QUESTION", deletedAt: null },
        }),
        presence.count(stream.id),
      ]);

    const byRendition = await prisma.viewerSession.groupBy({
      by: ["maxRendition"],
      where: { streamId: stream.id, maxRendition: { not: null } },
      _count: { _all: true },
    });

    return {
      currentViewers: current,
      peakViewers: stream.peakViewers,
      totalSessions: sessions,
      uniqueViewers,
      chatMessages: messages,
      questions,
      qualityDistribution: byRendition.map((row) => ({
        rendition: row.maxRendition,
        viewers: row._count._all,
      })),
      startedAt: stream.startedAt?.toISOString() ?? null,
      endedAt: stream.endedAt?.toISOString() ?? null,
    };
  });

  /** Public-ish metadata for the ingest hostnames, used by the OBS panel. */
  app.get("/:id/ingest-info", async (request) => {
    const { id } = validate.params(idParam, request);
    await requireControl(request, id);
    return {
      rtmpUrl: env.INGEST_RTMP_URL,
      srtHost: env.INGEST_SRT_HOST,
      srtPort: env.INGEST_SRT_PORT,
    };
  });
}
