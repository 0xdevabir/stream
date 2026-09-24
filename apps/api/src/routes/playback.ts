import {
  type PlaybackGrant,
  type PlaybackStatus,
  requestPlaybackSchema,
} from "@stream/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  PLAYBACK_TOKEN_HEADER,
  clearPlaybackCookie,
  playbackTokenFrom,
  setPlaybackCookie,
} from "../auth/cookies";
import { type PlaybackClaims, verifyEmbedToken, verifyPlaybackToken } from "../auth/tokens";
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
        // here, so it is the right place for a strict limit. Embeds and
        // renewals are exempt: they present a signed token rather than a
        // guessable secret, and a whole classroom embedding one class often
        // shares a single school NAT address. Neither path falls back to the
        // password check, so the exemption cannot be used to brute-force one.
        rateLimit: {
          max: 30,
          timeWindow: "5 minutes",
          hook: "preHandler",
          allowList: (request) =>
            typeof request.headers[PLAYBACK_TOKEN_HEADER] === "string" ||
            typeof (request.body as { embedToken?: unknown } | undefined)
              ?.embedToken === "string",
        },
      },
    },
    async (request, reply) => {
      const { id } = validate.params(idParam, request);
      const input = validate.body(requestPlaybackSchema, request);
      const stream = await streams.requireStream(id);

      // Header mode: the caller is an embedded player that cannot rely on
      // cookies, so the token travels in the response body and comes back as
      // X-Playback-Token.
      let headerMode = false;
      let userId = request.auth?.userId ?? null;
      let renewing: PlaybackClaims | null = null;

      const presented = request.headers[PLAYBACK_TOKEN_HEADER];
      if (input.embedToken) {
        const embed = await verifyEmbedToken(input.embedToken);
        if (
          !embed ||
          embed.streamId !== stream.id ||
          embed.organizationId !== stream.organizationId
        ) {
          throw new ApiError(401, "invalid_embed_token", "This embed link is invalid or has expired");
        }
        headerMode = true;
        userId = null;
      } else if (typeof presented === "string") {
        // Renewal: a still-valid session for this class is swapped for a
        // fresh one, without repeating the original access check.
        renewing = await verifyPlaybackToken(presented);
        if (
          !renewing ||
          renewing.streamId !== stream.id ||
          !(await playbackService.isPlaybackSessionActive(renewing.jti))
        ) {
          throw new ApiError(401, "invalid_playback_token", "Playback session expired; reload the player");
        }
        headerMode = true;
        userId = renewing.userId;
      } else {
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
        userId,
        scope,
        recordingId: recordingId ?? undefined,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      if (renewing) await playbackService.revokePlaybackSession(renewing.jti);
      if (!headerMode) setPlaybackCookie(reply, session.token);

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
        ...(headerMode ? { playbackToken: session.token } : {}),
      };

      return grant;
    },
  );

  /**
   * Called on page unload. Best-effort: a viewer who simply closes the laptop
   * lid never reaches this, which is why sessions also expire on their own.
   */
  app.post("/:id/playback/end", async (request, reply) => {
    const token = playbackTokenFrom(request);
    if (token) {
      const claims = await verifyPlaybackToken(token);
      if (claims) await playbackService.revokePlaybackSession(claims.jti);
    }

    clearPlaybackCookie(reply);
    return reply.code(204).send();
  });


  /**
   * What an embedded player polls while it waits for a class to start or its
   * replay to be ready. Authorized by the playback session, not a user login,
   * because an embed has none.
   */
  app.get("/:id/playback/status", async (request) => {
    const { id } = validate.params(idParam, request);
    const token = playbackTokenFrom(request);
    const claims = token ? await verifyPlaybackToken(token) : null;
    if (!claims || !(await playbackService.isPlaybackSessionActive(claims.jti))) {
      throw ApiError.unauthorized("No playback session");
    }

    const stream = await streams.requireStream(id);
    if (stream.id !== claims.streamId) {
      throw ApiError.forbidden("This session is for a different class");
    }

    const status: PlaybackStatus = {
      streamId: stream.id,
      status: stream.status,
      hlsUrl: streams.playbackUrls(stream).hlsUrl,
      vodUrl: streams.recordingUrl(stream.recordings[0]?.id ?? null),
    };
    return status;
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
