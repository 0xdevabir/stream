import { postMessageSchema } from "@stream/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { COOKIE } from "../auth/cookies";
import { verifyPlaybackToken } from "../auth/tokens";
import { ApiError } from "../errors";
import { canModerate, denialStatus, resolveStreamAccess } from "../services/access";
import * as chat from "../services/chat";
import { isPlaybackSessionActive } from "../services/playback";
import * as streams from "../services/streams";
import * as validate from "../validate";

const idParam = z.object({ id: z.string().min(1).max(128) });

/**
 * Confirms the caller may see this class's chat.
 *
 * The fast path is the playback cookie the watch page already holds -- a
 * signature check plus one Redis lookup. Only a caller without one (an
 * instructor opening the Q&A queue from the dashboard, say) falls through to
 * the full access resolution.
 */
export async function requireViewer(
  request: FastifyRequest,
  idOrSlug: string,
): Promise<{
  stream: Awaited<ReturnType<typeof streams.requireStream>>;
  viewerId: string | null;
  isModerator: boolean;
}> {
  const stream = await streams.requireStream(idOrSlug);

  const context = {
    userId: request.auth?.userId ?? null,
    organizationId: request.auth?.organizationId ?? null,
    role: request.auth?.role ?? null,
  };
  const isModerator = canModerate(stream, context);

  if (isModerator) {
    return { stream, viewerId: context.userId, isModerator };
  }

  const token = request.cookies[COOKIE.playback];
  if (token) {
    const claims = await verifyPlaybackToken(token);
    if (
      claims &&
      claims.streamId === stream.id &&
      (await isPlaybackSessionActive(claims.jti))
    ) {
      return { stream, viewerId: claims.userId, isModerator: false };
    }
  }

  const decision = await resolveStreamAccess(stream, context);
  if (!decision.allowed) {
    throw new ApiError(
      denialStatus(decision.reason),
      decision.reason,
      "You do not have access to this class",
    );
  }

  return { stream, viewerId: context.userId, isModerator: false };
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:id/messages", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream, viewerId } = await requireViewer(request, id);

    return {
      messages: await chat.listRecent({
        streamId: stream.id,
        instructorId: stream.instructorId,
        viewerId,
      }),
      slowModeSeconds: stream.slowModeSeconds,
    };
  });

  app.get("/:id/questions", async (request) => {
    const { id } = validate.params(idParam, request);
    const { stream, viewerId, isModerator } = await requireViewer(request, id);
    const { includeAnswered } = validate.query(
      z.object({ includeAnswered: z.coerce.boolean().optional() }),
      request,
    );

    return {
      questions: await chat.listQuestions({
        streamId: stream.id,
        instructorId: stream.instructorId,
        viewerId,
        includeAnswered: includeAnswered ?? isModerator,
      }),
    };
  });

  /**
   * REST fallback for posting. The WebSocket is the normal path -- it is what
   * gives the sender an immediate echo and everyone else the fanout -- but a
   * client whose socket has dropped can still post through here.
   */
  app.post(
    "/:id/messages",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = validate.params(idParam, request);
      const input = validate.body(postMessageSchema, request);
      const { stream, viewerId, isModerator } = await requireViewer(request, id);

      if (!viewerId) {
        throw ApiError.unauthorized("Sign in to take part in chat");
      }
      if (input.kind === "CHAT" && !stream.chatEnabled) {
        throw ApiError.forbidden("Chat is turned off for this class");
      }
      if (input.kind === "QUESTION" && !stream.questionsEnabled) {
        throw ApiError.forbidden("Questions are turned off for this class");
      }

      const message = await chat.postMessage({
        streamId: stream.id,
        instructorId: stream.instructorId,
        userId: viewerId,
        body: input.body,
        kind: input.kind,
        slowModeSeconds: stream.slowModeSeconds,
        isModerator,
      });

      return reply.code(201).send({ message });
    },
  );
}
