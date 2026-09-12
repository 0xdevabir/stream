import { type PlaybackGrant, requestPlaybackSchema } from "@stream/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { COOKIE, clearPlaybackCookie, setPlaybackCookie } from "../auth/cookies";
import { verifyPlaybackToken } from "../auth/tokens";
import { ApiError } from "../errors";
import { denialStatus, resolveStreamAccess } from "../services/access";
import * as playbackService from "../services/playback";
import * as streams from "../services/streams";
import * as validate from "../validate";

const idParam = z.object({ id: z.string().min(1).max(128) });

/**
 * Turning "may this person watch?" into a cookie the edge can check.
 *
 * This runs once when the watch page loads. Everything after it -- thousands
 * of segment requests, the AES key fetch, the WebSocket -- is authorized
 * against the cookie this endpoint sets, which is what keeps the per-viewer
 * cost of a large class close to zero.
 */
export async function playbackRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/:id/playback",
    {
      config: {
        // Brute-forcing a class password or share token has to go through
        // here, so it is the right place for a strict limit.
        rateLimit: { max: 30, timeWindow: "5 minutes" },
      },
    },
    async (request, reply) => {
      const { id } = validate.params(idParam, request);
      const input = validate.body(requestPlaybackSchema, request);
      const stream = await streams.requireStream(id);

      const decision = await resolveStreamAccess(stream, {
        userId: request.auth?.userId ?? null,
        organizationId: request.auth?.organizationId ?? null,
        role: request.auth?.role ?? null,
        password: input.password,
        shareToken: input.shareToken,
      });

      if (!decision.allowed) {
        return reply.code(denialStatus(decision.reason)).send({
          error: {
            code: decision.reason,
            message: describeDenial(decision.reason),
          },
        });
      }

      if (stream.status === "CANCELLED") {
        throw ApiError.notFound("This class was cancelled");
      }

      const recordingId = stream.recordings[0]?.id ?? null;

      // A class that has ended is watched as VOD; the scope is baked into the
      // token so a live grant cannot be replayed against a recording.
      const scope = stream.status === "ENDED" && recordingId ? "vod" : "live";

      const session = await playbackService.issuePlaybackSession({
        streamId: stream.id,
        userId: request.auth?.userId ?? null,
        scope,
        recordingId: recordingId ?? undefined,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      setPlaybackCookie(reply, session.token);

      const urls = streams.playbackUrls(stream);

      const grant: PlaybackGrant = {
        streamId: stream.id,
        status: stream.status,
        hlsUrl: urls.hlsUrl,
        whepUrl: urls.whepUrl,
        whepToken: urls.whepUrl ? session.token : null,
        vodUrl: streams.recordingUrl(recordingId),
        expiresAt: session.expiresAt.toISOString(),
        renditions: streams.ladder.map((rendition) => rendition.name),
        chatEnabled: stream.chatEnabled,
        questionsEnabled: stream.questionsEnabled,
      };

      return grant;
    },
  );

  /**
   * Called on page unload. Best-effort: a viewer who simply closes the laptop
   * lid never reaches this, which is why sessions also expire on their own.
   */
  app.post("/:id/playback/end", async (request, reply) => {
    const token = request.cookies[COOKIE.playback];
    if (token) {
      const claims = await verifyPlaybackToken(token);
      if (claims) await playbackService.revokePlaybackSession(claims.jti);
    }

    clearPlaybackCookie(reply);
    return reply.code(204).send();
  });
}

function describeDenial(reason: string): string {
  switch (reason) {
    case "authentication_required":
      return "Sign in to watch this class";
    case "password_required":
      return "This class requires a password";
    case "invalid_password":
      return "That password is not correct";
    case "invalid_link":
      return "This class link is not valid";
    case "not_enrolled":
      return "You are not enrolled in this class";
    case "not_in_organization":
      return "This class belongs to a different organization";
    default:
      return "You do not have access to this class";
  }
}
