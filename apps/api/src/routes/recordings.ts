import { type Recording, vodMasterUrl } from "@stream/shared";
import { prisma } from "@stream/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { setPlaybackCookie } from "../auth/cookies";
import { requireAuth } from "../auth/session";
import { ApiError } from "../errors";
import {
  canModerate,
  denialStatus,
  resolveStreamAccess,
} from "../services/access";
import { issuePlaybackSession } from "../services/playback";
import { deletePrefix, presignDownload } from "../services/storage";
import * as validate from "../validate";

const idParam = z.object({ id: z.string().min(1).max(128) });

const RECORDING_SELECT = {
  id: true,
  streamId: true,
  status: true,
  durationSeconds: true,
  sizeBytes: true,
  segmentCount: true,
  renditions: true,
  posterKey: true,
  downloadKey: true,
  createdAt: true,
  stream: {
    select: {
      id: true,
      title: true,
      organizationId: true,
      instructorId: true,
      courseId: true,
      accessMode: true,
      passwordHash: true,
      shareToken: true,
    },
  },
} as const;

type RecordingRow = {
  id: string;
  streamId: string;
  status: string;
  durationSeconds: number | null;
  sizeBytes: bigint | null;
  renditions: string[];
  posterKey: string | null;
  downloadKey: string | null;
  createdAt: Date;
  stream: { title: string };
};

function serialize(row: RecordingRow): Recording {
  return {
    id: row.id,
    streamId: row.streamId,
    title: row.stream.title,
    status: row.status as Recording["status"],
    durationSeconds: row.durationSeconds,
    // BigInt does not survive JSON.stringify; a recording's byte count fits
    // in a double long before it fits in a hard disk.
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    posterUrl: row.posterKey ? `/vod/${row.id}/poster.jpg` : null,
    vodUrl: row.status === "READY" ? vodMasterUrl(row.id) : null,
    downloadUrl: row.downloadKey ? `/v1/recordings/${row.id}/download` : null,
    createdAt: row.createdAt.toISOString(),
    renditions: row.renditions as Recording["renditions"],
  };
}

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  /** The replay library. Students see recordings of classes they can access. */
  app.get("/", async (request) => {
    const auth = requireAuth(request);
    const { streamId, courseId, limit, cursor } = validate.query(
      z.object({
        streamId: z.string().max(128).optional(),
        courseId: z.string().max(128).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().max(200).optional(),
      }),
      request,
    );

    const rows = await prisma.recording.findMany({
      where: {
        status: "READY",
        stream: {
          organizationId: auth.organizationId,
          ...(streamId ? { id: streamId } : {}),
          ...(courseId ? { courseId } : {}),
        },
      },
      select: RECORDING_SELECT,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Filter to what this viewer may actually watch. Done after the query
    // because access depends on enrollment, which varies per recording.
    const visible = [];
    for (const row of page) {
      const decision = await resolveStreamAccess(
        { ...row.stream, id: row.stream.id },
        {
          userId: auth.userId,
          organizationId: auth.organizationId,
          role: auth.role,
        },
      );
      if (decision.allowed) visible.push(serialize(row));
    }

    return {
      items: visible,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  });

  app.get("/:id", async (request) => {
    const { id } = validate.params(idParam, request);
    const row = await prisma.recording.findUnique({
      where: { id },
      select: RECORDING_SELECT,
    });
    if (!row) throw ApiError.notFound("Recording not found");

    const decision = await resolveStreamAccess(
      { ...row.stream, id: row.stream.id },
      {
        userId: request.auth?.userId ?? null,
        organizationId: request.auth?.organizationId ?? null,
        role: request.auth?.role ?? null,
      },
    );
    if (!decision.allowed) {
      throw new ApiError(
        denialStatus(decision.reason),
        decision.reason,
        "You do not have access to this recording",
      );
    }

    return { recording: serialize(row) };
  });

  /**
   * Issues a playback cookie scoped to this recording's class, so the edge
   * will serve its segments and the key endpoint will hand over the AES key.
   */
  app.post("/:id/playback", async (request, reply) => {
    const { id } = validate.params(idParam, request);
    const row = await prisma.recording.findUnique({
      where: { id },
      select: RECORDING_SELECT,
    });
    if (!row || row.status !== "READY") {
      throw ApiError.notFound("Recording not available");
    }

    const decision = await resolveStreamAccess(
      { ...row.stream, id: row.stream.id },
      {
        userId: request.auth?.userId ?? null,
        organizationId: request.auth?.organizationId ?? null,
        role: request.auth?.role ?? null,
      },
    );
    if (!decision.allowed) {
      throw new ApiError(
        denialStatus(decision.reason),
        decision.reason,
        "You do not have access to this recording",
      );
    }

    const session = await issuePlaybackSession({
      streamId: row.streamId,
      userId: request.auth?.userId ?? null,
      scope: "vod",
      recordingId: row.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    setPlaybackCookie(reply, session.token);

    return {
      recording: serialize(row),
      vodUrl: vodMasterUrl(row.id),
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  /** Time-limited direct link to the progressive MP4. */
  app.get("/:id/download", async (request, reply) => {
    const { id } = validate.params(idParam, request);
    const row = await prisma.recording.findUnique({
      where: { id },
      select: RECORDING_SELECT,
    });
    if (!row?.downloadKey) throw ApiError.notFound("No download available");

    const decision = await resolveStreamAccess(
      { ...row.stream, id: row.stream.id },
      {
        userId: request.auth?.userId ?? null,
        organizationId: request.auth?.organizationId ?? null,
        role: request.auth?.role ?? null,
      },
    );
    if (!decision.allowed) {
      throw new ApiError(
        denialStatus(decision.reason),
        decision.reason,
        "You do not have access to this recording",
      );
    }

    const url = await presignDownload(row.downloadKey, {
      expiresInSeconds: 900,
      filename: `${row.stream.title.replace(/[^\w.-]+/g, "_")}.mp4`,
    });

    return reply.redirect(url, 302);
  });

  app.delete("/:id", async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = validate.params(idParam, request);

    const row = await prisma.recording.findUnique({
      where: { id },
      select: RECORDING_SELECT,
    });
    if (!row) throw ApiError.notFound("Recording not found");

    if (
      !canModerate(row.stream, {
        userId: auth.userId,
        organizationId: auth.organizationId,
        role: auth.role,
      })
    ) {
      throw ApiError.forbidden("Only the instructor can delete this recording");
    }

    // Objects first: a row without its objects is a broken link, whereas
    // objects without a row are merely unreferenced and can be swept later.
    if (row.status === "READY") {
      await deletePrefix(`vod/${row.id}`);
    }
    await prisma.recording.delete({ where: { id: row.id } });

    return reply.code(204).send();
  });
}
