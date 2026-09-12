import { hashIp, prisma } from "@stream/db";

import { env } from "../env";
import { signPlaybackToken } from "../auth/tokens";
import { playbackSessionKey, redis, userSessionsKey } from "../redis";

/**
 * The playback session registry.
 *
 * A playback token is a signed JWT, but signature validity alone is not enough
 * -- we also need to revoke a session immediately (a student removed from a
 * class mid-lecture) and cap how many devices one account can stream to at
 * once. Both need server-side state, so every issued token has a matching
 * Redis key whose *existence* is what authorizes delivery.
 *
 * Redis rather than Postgres because this is read on the hot path (once per
 * viewer per nginx cache window) and every entry expires on its own.
 */

export interface PlaybackSession {
  streamId: string;
  userId: string | null;
  scope: "live" | "vod";
  recordingId?: string;
  issuedAt: number;
}

export interface IssuePlaybackOptions {
  streamId: string;
  userId: string | null;
  scope: "live" | "vod";
  recordingId?: string | undefined;
  ip: string;
  userAgent?: string | undefined;
}

/**
 * Evicts expired sessions, enforces the per-user cap by dropping the oldest
 * session, and registers the new one -- atomically, so two simultaneous joins
 * cannot both slip past the limit.
 *
 * Returns the jtis that were evicted so their session keys can be deleted.
 */
const CAP_SCRIPT = `
local zkey = KEYS[1]
local now = tonumber(ARGV[1])
local jti = ARGV[2]
local expiresAt = tonumber(ARGV[3])
local max = tonumber(ARGV[4])

redis.call('ZREMRANGEBYSCORE', zkey, '-inf', now)

local evicted = {}
while redis.call('ZCARD', zkey) >= max do
  local popped = redis.call('ZPOPMIN', zkey)
  if not popped or #popped == 0 then break end
  table.insert(evicted, popped[1])
end

redis.call('ZADD', zkey, expiresAt, jti)
redis.call('PEXPIRE', zkey, expiresAt - now)
return evicted
`;

export async function issuePlaybackSession(
  options: IssuePlaybackOptions,
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const { token, jti, expiresAt } = await signPlaybackToken({
    userId: options.userId,
    streamId: options.streamId,
    scope: options.scope,
    ...(options.recordingId ? { recordingId: options.recordingId } : {}),
  });

  const session: PlaybackSession = {
    streamId: options.streamId,
    userId: options.userId,
    scope: options.scope,
    ...(options.recordingId ? { recordingId: options.recordingId } : {}),
    issuedAt: Date.now(),
  };

  const ttlSeconds = env.PLAYBACK_TOKEN_TTL;
  await redis.set(
    playbackSessionKey(jti),
    JSON.stringify(session),
    "EX",
    ttlSeconds,
  );

  // Anonymous viewers of a public class have no identity to cap against.
  if (options.userId) {
    const evicted = (await redis.eval(
      CAP_SCRIPT,
      1,
      userSessionsKey(options.userId, options.streamId),
      String(Date.now()),
      jti,
      String(expiresAt.getTime()),
      String(env.MAX_CONCURRENT_SESSIONS_PER_USER),
    )) as string[];

    if (evicted.length > 0) {
      await redis.del(...evicted.map(playbackSessionKey));
    }
  }

  // Analytics only -- deliberately not awaited into the critical path, and a
  // failure here must never stop a student from watching.
  void recordViewerSession(jti, options).catch(() => undefined);

  return { token, jti, expiresAt };
}

async function recordViewerSession(
  jti: string,
  options: IssuePlaybackOptions,
): Promise<void> {
  await prisma.viewerSession.create({
    data: {
      streamId: options.streamId,
      userId: options.userId,
      tokenId: jti,
      ipHash: hashIp(options.ip, env.AUTH_SECRET),
      userAgent: options.userAgent?.slice(0, 400) ?? null,
    },
  });
}

export async function getPlaybackSession(
  jti: string,
): Promise<PlaybackSession | null> {
  const raw = await redis.get(playbackSessionKey(jti));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlaybackSession;
  } catch {
    return null;
  }
}

/** Cheapest possible validity check; used by the edge authz endpoint. */
export async function isPlaybackSessionActive(jti: string): Promise<boolean> {
  return (await redis.exists(playbackSessionKey(jti))) === 1;
}

export async function revokePlaybackSession(jti: string): Promise<void> {
  const session = await getPlaybackSession(jti);
  await redis.del(playbackSessionKey(jti));

  if (session?.userId) {
    await redis.zrem(userSessionsKey(session.userId, session.streamId), jti);
  }

  await prisma.viewerSession
    .updateMany({
      where: { tokenId: jti, leftAt: null },
      data: { leftAt: new Date() },
    })
    .catch(() => undefined);
}

/** Revokes every session for one viewer of one stream (e.g. un-enrolled). */
export async function revokeUserSessions(
  userId: string,
  streamId: string,
): Promise<number> {
  const key = userSessionsKey(userId, streamId);
  const jtis = await redis.zrange(key, 0, -1);
  if (jtis.length === 0) return 0;

  await redis.del(key, ...jtis.map(playbackSessionKey));
  return jtis.length;
}

/** Keeps the analytics row current; called from the WebSocket heartbeat. */
export async function touchViewerSession(
  jti: string,
  update: { maxRendition?: string; watchSeconds?: number },
): Promise<void> {
  await prisma.viewerSession
    .updateMany({
      where: { tokenId: jti },
      data: {
        lastSeenAt: new Date(),
        ...(update.maxRendition ? { maxRendition: update.maxRendition } : {}),
        ...(update.watchSeconds !== undefined
          ? { watchSeconds: update.watchSeconds }
          : {}),
      },
    })
    .catch(() => undefined);
}
