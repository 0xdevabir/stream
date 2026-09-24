import { randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../env";

/**
 * Cookies, not Authorization headers.
 *
 * This is the decision that makes the whole delivery path simple: because the
 * playback grant is a cookie on the same origin as the segments, nginx can
 * authorize each request with `auth_request`, and iOS Safari's *native* HLS
 * player -- which gives us no hook to attach a header -- works unmodified.
 *
 * The cost is CSRF exposure, handled by SameSite=Lax plus the double-submit
 * token below.
 */
export const COOKIE = {
  access: "at",
  refresh: "rt",
  /** Read by nginx as `$cookie_pt`; renaming this means editing the edge config. */
  playback: "pt",
  csrf: "csrf",
} as const;

function base(maxAgeSeconds: number) {
  return {
    path: "/",
    httpOnly: true,
    // Lax still sends the cookie on top-level navigations, which is what a
    // student following a class link does. Strict would break that.
    sameSite: "lax" as const,
    secure: env.cookieSecure,
    maxAge: maxAgeSeconds,
  };
}

export function setAccessCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE.access, token, base(env.ACCESS_TOKEN_TTL));
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE.refresh, token, base(env.REFRESH_TOKEN_TTL));
}

export function setPlaybackCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE.playback, token, base(env.PLAYBACK_TOKEN_TTL));
}

/**
 * Double-submit CSRF token. Deliberately readable by JavaScript: the client
 * copies it into an `X-CSRF-Token` header, and an attacker on another origin
 * can send the cookie but cannot read it to set the header.
 */
export function issueCsrfToken(reply: FastifyReply): string {
  const token = randomBytes(16).toString("base64url");
  reply.setCookie(COOKIE.csrf, token, {
    ...base(env.REFRESH_TOKEN_TTL),
    httpOnly: false,
  });
  return token;
}

export function clearAuthCookies(reply: FastifyReply): void {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.csrf]) {
    reply.clearCookie(name, { path: "/" });
  }
}

export function clearPlaybackCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE.playback, { path: "/" });
}

/** Header an embedded player sends instead of the cookie (see below). */
export const PLAYBACK_TOKEN_HEADER = "x-playback-token";

/**
 * The playback token, from the cookie or the X-Playback-Token header.
 *
 * Embeds need the header: a player in a customer's iframe is a third-party
 * context, where Safari (and increasingly Chrome) drop our cookies. hls.js
 * attaches the header to every playlist, segment and key request, and nginx
 * forwards it to the authz subrequest. The header wins when both are present
 * because it is the more specific credential.
 */
export function playbackTokenFrom(request: FastifyRequest): string | undefined {
  const header = request.headers[PLAYBACK_TOKEN_HEADER];
  if (typeof header === "string" && header.length > 0) return header;
  return request.cookies[COOKIE.playback];
}
