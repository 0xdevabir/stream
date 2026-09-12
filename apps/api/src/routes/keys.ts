import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { COOKIE } from "../auth/cookies";
import { verifyPlaybackToken } from "../auth/tokens";
import { ApiError } from "../errors";
import { findContentKeyById } from "../services/content-keys";
import { isPlaybackSessionActive } from "../services/playback";
import * as validate from "../validate";

const keyParam = z.object({ keyId: z.string().min(1).max(128) });

/**
 * AES-128 key delivery -- the endpoint the whole encryption story rests on.
 *
 * The URL here is what ffmpeg writes into every playlist's EXT-X-KEY line, so
 * a player fetches it automatically before decoding the first segment. If this
 * returns 401, the viewer holds nothing but ciphertext.
 *
 * Two independent checks: the playback token must be valid *and* its session
 * must still exist in Redis. The second is what makes revocation immediate.
 */
export async function keyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/:keyId",
    {
      config: {
        // A player fetches the key once per key rotation, not once per
        // segment, so a low ceiling here is generous in normal use and
        // hostile to anyone enumerating key ids.
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { keyId } = validate.params(keyParam, request);

      const token = request.cookies[COOKIE.playback];
      if (!token) throw ApiError.unauthorized("No playback session");

      const claims = await verifyPlaybackToken(token);
      if (!claims) throw ApiError.unauthorized("Invalid playback session");

      if (!(await isPlaybackSessionActive(claims.jti))) {
        throw ApiError.unauthorized("Playback session has been revoked");
      }

      const record = await findContentKeyById(keyId);
      if (!record) throw ApiError.notFound("Unknown key");

      // The decisive check: the session must have been granted for the very
      // stream this key belongs to. Without it, any valid viewer of any public
      // class could decrypt every other class on the platform.
      if (record.streamId !== claims.streamId) {
        throw ApiError.forbidden("This key belongs to a different class");
      }

      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(record.key.length))
        // Players may hold the key for the life of the session, but it must
        // never touch a shared cache or survive on disk.
        .header("Cache-Control", "private, no-store, max-age=0")
        .send(record.key);
    },
  );
}
