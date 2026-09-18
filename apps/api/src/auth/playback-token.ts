import type { FastifyRequest } from "fastify";

import { COOKIE } from "../auth/cookies";

/**
 * Playback credentials may arrive three ways:
 *   1. HttpOnly cookie `pt` — same-origin web app / Safari native HLS
 *   2. `?token=` query — CDN/embed signed URLs
 *   3. `Authorization: Bearer` — hls.js xhrSetup on cross-origin embeds
 *   4. `X-Playback-Token` — set by nginx/CDN when forwarding to authz
 */
export function extractPlaybackToken(request: FastifyRequest): string | null {
  const header = request.headers["x-playback-token"];
  if (typeof header === "string" && header.length > 0) return header;

  const auth = request.headers.authorization;
  if (typeof auth === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match?.[1]) return match[1];
  }

  const query = request.query;
  if (query && typeof query === "object" && "token" in query) {
    const value = (query as { token?: unknown }).token;
    if (typeof value === "string" && value.length > 0) return value;
  }

  const cookie = request.cookies?.[COOKIE.playback];
  if (typeof cookie === "string" && cookie.length > 0) return cookie;

  return null;
}
