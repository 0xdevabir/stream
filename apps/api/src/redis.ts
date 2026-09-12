import Redis from "ioredis";

import { env } from "./env";

/**
 * Redis carries the three things Postgres is a poor fit for: the playback
 * session registry (high write rate, TTL-based expiry), live viewer presence,
 * and chat fanout between API instances.
 *
 * A connection in subscriber mode cannot issue ordinary commands, so the
 * pub/sub side gets its own connection.
 */
function connect(role: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });

  client.on("error", (error) => {
    // ioredis reconnects on its own; logging every attempt would drown the log.
    if (process.env.NODE_ENV !== "test") {
      console.error(`redis(${role}): ${error.message}`);
    }
  });

  return client;
}

export const redis = connect("commands");
export const redisSubscriber = connect("subscriber");

export async function pingRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}

// ── Key namespaces ─────────────────────────────────────────────────────────

/** An issued playback session. Presence of the key is what makes it valid. */
export const playbackSessionKey = (jti: string) => `pb:${jti}`;

/** Set of a user's active playback sessions for one stream (concurrency cap). */
export const userSessionsKey = (userId: string, streamId: string) =>
  `pbuser:${userId}:${streamId}`;

/** Cached ingest state published by the transcoder, read by the API. */
export const streamStateKey = (streamId: string) => `stream:${streamId}:state`;

/** Per-user last-message timestamp, used to enforce slow mode. */
export const slowModeKey = (streamId: string, userId: string) =>
  `slow:${streamId}:${userId}`;
