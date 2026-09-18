import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { extractPlaybackToken } from "../auth/playback-token";
import { verifyPlaybackToken } from "../auth/tokens";
import { ApiError } from "../errors";
import { findContentKeyById } from "../services/content-keys";
import { isPlaybackSessionActive } from "../services/playback";
import * as validate from "../validate";

const keyParam = z.object({ keyId: z.string().min(1).max(128) });

/**
 * AES-128 key delivery -- the endpoint the whole encryption story rests on.
 *
 * Accepts the same playback credentials as the edge: cookie, Bearer token,
 * or `?token=` (for cross-origin embeds via hls.js xhrSetup).
 */
export async function keyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/:keyId",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { keyId } = validate.params(keyParam, request);

      const token = extractPlaybackToken(request);
      if (!token) throw ApiError.unauthorized("No playback session");

      const claims = await verifyPlaybackToken(token);
      if (!claims) throw ApiError.unauthorized("Invalid playback session");

      if (!(await isPlaybackSessionActive(claims.jti))) {
        throw ApiError.unauthorized("Playback session has been revoked");
      }

      const record = await findContentKeyById(keyId);
      if (!record) throw ApiError.notFound("Unknown key");

      if (record.streamId !== claims.streamId) {
        throw ApiError.forbidden("This key belongs to a different class");
      }

      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(record.key.length))
        .header("Cache-Control", "private, no-store, max-age=0")
        .header("Access-Control-Allow-Origin", "*")
        .send(record.key);
    },
  );
}
