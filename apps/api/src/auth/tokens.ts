import { randomBytes } from "node:crypto";

import type { OrgRole } from "@stream/shared";
import { SignJWT, jwtVerify } from "jose";

import { env } from "../env";

/**
 * Four kinds of token, deliberately signed with two different secrets.
 *
 *  access   (AUTH_SECRET)     - who you are; sent on every API call
 *  refresh  (opaque, hashed in Postgres, not a JWT)
 *  playback (PLAYBACK_SECRET) - what you may watch; read by the edge and the
 *                               AES key endpoint on the hot path
 *  publish  (PLAYBACK_SECRET) - permission to push media into one stream
 *
 * Splitting the secrets means the media plane can be given PLAYBACK_SECRET
 * without also handing it the ability to mint user sessions.
 */
const authKey = new TextEncoder().encode(env.AUTH_SECRET);
const playbackKey = new TextEncoder().encode(env.PLAYBACK_SECRET);

const ALG = "HS256";
const ISSUER = "stream";

// ── Access tokens ──────────────────────────────────────────────────────────

export interface AccessClaims {
  userId: string;
  organizationId: string;
  role: OrgRole;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ org: claims.organizationId, role: claims.role })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience("access")
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(authKey);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, authKey, {
      issuer: ISSUER,
      audience: "access",
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.org !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      organizationId: payload.org,
      role: payload.role as OrgRole,
    };
  } catch {
    return null;
  }
}

// ── Refresh tokens ─────────────────────────────────────────────────────────

/**
 * Opaque and random rather than a JWT: refresh tokens must be revocable, which
 * means a database lookup regardless, and that removes any benefit of a
 * self-contained token.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

// ── Playback tokens ────────────────────────────────────────────────────────

export interface PlaybackClaims {
  /** Null for anonymous viewers of PUBLIC / LINK / PASSWORD classes. */
  userId: string | null;
  streamId: string;
  /** Session id; also the Redis key that makes this token revocable. */
  jti: string;
  scope: "live" | "vod";
  /** Set for VOD playback so the edge can scope the grant to one recording. */
  recordingId?: string;
}

export async function signPlaybackToken(
  claims: Omit<PlaybackClaims, "jti"> & { jti?: string },
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = claims.jti ?? randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + env.PLAYBACK_TOKEN_TTL * 1000);

  const builder = new SignJWT({
    sid: claims.streamId,
    scope: claims.scope,
    ...(claims.recordingId ? { rid: claims.recordingId } : {}),
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience("playback")
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${env.PLAYBACK_TOKEN_TTL}s`);

  if (claims.userId) builder.setSubject(claims.userId);

  return { token: await builder.sign(playbackKey), jti, expiresAt };
}

export async function verifyPlaybackToken(
  token: string,
): Promise<PlaybackClaims | null> {
  try {
    const { payload } = await jwtVerify(token, playbackKey, {
      issuer: ISSUER,
      audience: "playback",
    });
    if (
      typeof payload.sid !== "string" ||
      typeof payload.jti !== "string" ||
      (payload.scope !== "live" && payload.scope !== "vod")
    ) {
      return null;
    }
    return {
      userId: typeof payload.sub === "string" ? payload.sub : null,
      streamId: payload.sid,
      jti: payload.jti,
      scope: payload.scope,
      ...(typeof payload.rid === "string" ? { recordingId: payload.rid } : {}),
    };
  } catch {
    return null;
  }
}

// ── Publish tokens ─────────────────────────────────────────────────────────

export interface PublishClaims {
  userId: string;
  streamId: string;
}

/**
 * Handed to the instructor's browser so it can POST a WHIP offer without ever
 * seeing the long-lived stream key. Short TTL: it is spent within seconds of
 * being issued, and a leaked one expires before it is useful.
 */
export async function signPublishToken(
  claims: PublishClaims,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + env.PUBLISH_TOKEN_TTL * 1000);
  const token = await new SignJWT({ sid: claims.streamId })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience("publish")
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.PUBLISH_TOKEN_TTL}s`)
    .sign(playbackKey);

  return { token, expiresAt };
}

export async function verifyPublishToken(
  token: string,
): Promise<PublishClaims | null> {
  try {
    const { payload } = await jwtVerify(token, playbackKey, {
      issuer: ISSUER,
      audience: "publish",
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      return null;
    }
    return { userId: payload.sub, streamId: payload.sid };
  } catch {
    return null;
  }
}
