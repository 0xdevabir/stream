import { PRESENCE_TTL_MS, presenceKey } from "@stream/shared";

import { redis } from "../redis";

/**
 * Live viewer counts.
 *
 * A sorted set per stream, member = connection id, score = last heartbeat in
 * epoch ms. Counting viewers is then a single ZCOUNT over the last
 * PRESENCE_TTL_MS, and a viewer whose browser was closed without a clean
 * disconnect simply ages out instead of inflating the number forever.
 *
 * This is why the count is Redis-backed rather than derived from open
 * WebSockets: with more than one API instance, no single process sees them all.
 */

export async function join(
  streamId: string,
  connectionId: string,
): Promise<void> {
  const key = presenceKey(streamId);
  await redis
    .multi()
    .zadd(key, Date.now(), connectionId)
    // Safety net: if every viewer vanishes, the key disappears on its own.
    .pexpire(key, PRESENCE_TTL_MS * 4)
    .exec();
}

export async function heartbeat(
  streamId: string,
  connectionId: string,
): Promise<void> {
  await join(streamId, connectionId);
}

export async function leave(
  streamId: string,
  connectionId: string,
): Promise<void> {
  await redis.zrem(presenceKey(streamId), connectionId);
}

export async function count(streamId: string): Promise<number> {
  const key = presenceKey(streamId);
  const cutoff = Date.now() - PRESENCE_TTL_MS;

  // Drop stale members first so the set cannot grow without bound over a long
  // class, then count what is left.
  const [, current] = await redis
    .multi()
    .zremrangebyscore(key, "-inf", cutoff)
    .zcard(key)
    .exec()
    .then((results) => results ?? []);

  return typeof current?.[1] === "number" ? current[1] : 0;
}

/** One round trip for a list of streams, used by the dashboard. */
export async function countMany(
  streamIds: string[],
): Promise<Map<string, number>> {
  if (streamIds.length === 0) return new Map();

  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const pipeline = redis.pipeline();
  for (const id of streamIds) {
    pipeline.zcount(presenceKey(id), cutoff, "+inf");
  }

  const results = await pipeline.exec();
  const counts = new Map<string, number>();

  streamIds.forEach((id, index) => {
    const value = results?.[index]?.[1];
    counts.set(id, typeof value === "number" ? value : 0);
  });

  return counts;
}

export async function clear(streamId: string): Promise<void> {
  await redis.del(presenceKey(streamId));
}
