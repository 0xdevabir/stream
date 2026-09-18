import Redis from "ioredis";

import { env } from "./env";
import { logger } from "./logger";

/**
 * Encode leases so multiple transcoder replicas do not double-encode one live
 * input. The holder renews periodically; expiry frees the stream for takeover.
 */

let client: Redis | null = null;

function redis(): Redis {
  if (!client) {
    if (!env.REDIS_URL) {
      throw new Error("REDIS_URL is required for encode leases");
    }
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    client.on("error", (error) => {
      logger.warn({ err: error.message }, "redis lease connection error");
    });
  }
  return client;
}

const LEASE_TTL_SECONDS = 15;

export function leaseKey(streamId: string): string {
  return `encode:lease:${streamId}`;
}

export async function tryAcquireLease(
  streamId: string,
  workerId: string,
): Promise<boolean> {
  const result = await redis().set(
    leaseKey(streamId),
    workerId,
    "EX",
    LEASE_TTL_SECONDS,
    "NX",
  );
  if (result === "OK") return true;

  const holder = await redis().get(leaseKey(streamId));
  if (holder === workerId) {
    await redis().expire(leaseKey(streamId), LEASE_TTL_SECONDS);
    return true;
  }
  return false;
}

export async function renewLease(
  streamId: string,
  workerId: string,
): Promise<boolean> {
  const holder = await redis().get(leaseKey(streamId));
  if (holder !== workerId) return false;
  await redis().expire(leaseKey(streamId), LEASE_TTL_SECONDS);
  return true;
}

export async function releaseLease(
  streamId: string,
  workerId: string,
): Promise<void> {
  const holder = await redis().get(leaseKey(streamId));
  if (holder === workerId) {
    await redis().del(leaseKey(streamId));
  }
}

export async function closeLeaseRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
