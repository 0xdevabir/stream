import { timingSafeEqual } from "node:crypto";

import { type OrgRole, hasRole } from "@stream/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "../errors";
import { COOKIE } from "./cookies";
import { type AccessClaims, verifyAccessToken } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by `loadSession` on every request; undefined when signed out. */
    auth?: AccessClaims;
  }
}

/**
 * Resolves the session from the access cookie on every request.
 *
 * Role and organization are read from the token rather than the database, so
 * an ordinary API call costs zero queries to authenticate. The trade-off is
 * that a role change takes up to ACCESS_TOKEN_TTL (15 minutes by default) to
 * take effect; anything that must be immediate -- revoking access to a live
 * class -- is enforced against Redis in the playback path instead.
 */
export async function loadSession(request: FastifyRequest): Promise<void> {
  const token = request.cookies[COOKIE.access];
  if (!token) return;

  const claims = await verifyAccessToken(token);
  if (claims) request.auth = claims;
}

export function requireAuth(request: FastifyRequest): AccessClaims {
  if (!request.auth) throw ApiError.unauthorized();
  return request.auth;
}

export function requireRole(
  request: FastifyRequest,
  role: OrgRole,
): AccessClaims {
  const auth = requireAuth(request);
  if (!hasRole(auth.role, role)) {
    throw ApiError.forbidden(`This action requires the ${role} role`);
  }
  return auth;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit CSRF check on state-changing requests.
 *
 * Only enforced for cookie-authenticated callers: the internal service routes
 * authenticate with a bearer secret instead, and are mounted outside this
 * hook's scope.
 */
export async function verifyCsrf(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (SAFE_METHODS.has(request.method)) return;

  const cookie = request.cookies[COOKIE.csrf];
  const header = request.headers["x-csrf-token"];

  // No CSRF cookie means no cookie-based session to abuse (e.g. login itself).
  if (!cookie) return;

  if (typeof header !== "string" || header.length !== cookie.length) {
    throw ApiError.forbidden("Missing or invalid CSRF token");
  }
  if (!timingSafeEqual(Buffer.from(header), Buffer.from(cookie))) {
    throw ApiError.forbidden("Missing or invalid CSRF token");
  }
}

/** Client IP, trusting the edge's X-Forwarded-For (see `trustProxy` in app.ts). */
export function clientIp(request: FastifyRequest): string {
  return request.ip;
}
