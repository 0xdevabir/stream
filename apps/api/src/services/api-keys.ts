import {
  API_KEY_PREFIX,
  apiKeyDisplayPrefix,
  generateApiKey,
  hashStreamKey,
  prisma,
} from "@stream/db";
import { type ApiKeySummary, type CreatedApiKey, hasRole } from "@stream/shared";

import type { AccessClaims } from "../auth/tokens";
import { ApiError } from "../errors";
import { redis } from "../redis";

/**
 * Organization API keys: how a customer's backend drives the platform.
 *
 * A key acts as the admin who created it, inside that admin's organization,
 * and never above ADMIN -- an OWNER's key cannot do owner-only things. It is
 * checked against the database (through a short cache) on every use, so
 * revoking the key or demoting its creator takes effect within CACHE_MS.
 */

const CACHE_MS = 30_000;
const LAST_USED_WRITE_MS = 60_000;

/** Requests per key per minute. Generous for a backend, hostile to a leak. */
export const API_KEY_RATE_LIMIT = 600;

interface CachedKey {
  keyId: string;
  claims: AccessClaims | null;
  expiresAt: number;
}

const cache = new Map<string, CachedKey>();
const lastUsedWrites = new Map<string, number>();

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX);
}

/**
 * Resolves a presented key to the identity it acts as, or null when the key is
 * unknown, revoked, or its creator is no longer an admin of the organization.
 */
export async function authenticateApiKey(
  presented: string,
): Promise<{ keyId: string; claims: AccessClaims } | null> {
  if (!looksLikeApiKey(presented) || presented.length > 100) return null;

  const hash = hashStreamKey(presented);
  const now = Date.now();

  let entry = cache.get(hash);
  if (!entry || entry.expiresAt <= now) {
    entry = await lookup(hash, now);
    cache.set(hash, entry);
    // Bounded: unknown keys are cached too, so a flood of garbage keys must
    // not grow the map without limit.
    if (cache.size > 10_000) cache.clear();
  }

  if (!entry.claims) return null;

  touchLastUsed(entry.keyId, now);
  return { keyId: entry.keyId, claims: entry.claims };
}

async function lookup(hash: string, now: number): Promise<CachedKey> {
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      revokedAt: true,
    },
  });

  const expiresAt = now + CACHE_MS;
  if (!key || key.revokedAt) return { keyId: key?.id ?? "", claims: null, expiresAt };

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: key.createdById,
        organizationId: key.organizationId,
      },
    },
    select: { role: true },
  });
  if (!membership || !hasRole(membership.role, "ADMIN")) {
    return { keyId: key.id, claims: null, expiresAt };
  }

  return {
    keyId: key.id,
    claims: {
      userId: key.createdById,
      organizationId: key.organizationId,
      role: "ADMIN",
    },
    expiresAt,
  };
}

function touchLastUsed(keyId: string, now: number): void {
  const last = lastUsedWrites.get(keyId) ?? 0;
  if (now - last < LAST_USED_WRITE_MS) return;
  lastUsedWrites.set(keyId, now);
  void prisma.apiKey
    .update({ where: { id: keyId }, data: { lastUsedAt: new Date(now) } })
    .catch(() => undefined);
}

/**
 * Fixed one-minute window in Redis, shared by every API replica. Returns the
 * remaining allowance, or throws 429 once it is spent.
 */
export async function consumeApiKeyQuota(keyId: string): Promise<number> {
  const window = Math.floor(Date.now() / 60_000);
  const bucket = `rl:apikey:${keyId}:${window}`;
  const [[, count]] = (await redis
    .multi()
    .incr(bucket)
    .expire(bucket, 61)
    .exec()) as [[null, number], [null, number]];

  if (count > API_KEY_RATE_LIMIT) {
    throw ApiError.tooManyRequests(
      `API key rate limit of ${API_KEY_RATE_LIMIT} requests per minute exceeded`,
    );
  }
  return API_KEY_RATE_LIMIT - count;
}

// ── Management ─────────────────────────────────────────────────────────────

const SUMMARY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

type SummaryRow = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
};

function serialize(row: SummaryRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(organizationId: string): Promise<ApiKeySummary[]> {
  const rows = await prisma.apiKey.findMany({
    where: { organizationId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
  return rows.map(serialize);
}

export async function createApiKey(
  organizationId: string,
  createdById: string,
  name: string,
): Promise<CreatedApiKey> {
  const key = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      organizationId,
      createdById,
      name,
      prefix: apiKeyDisplayPrefix(key),
      keyHash: hashStreamKey(key),
    },
    select: SUMMARY_SELECT,
  });
  return { ...serialize(row), key };
}

/** Soft delete, so audit history keeps pointing at something. */
export async function revokeApiKey(
  organizationId: string,
  keyId: string,
): Promise<void> {
  const row = await prisma.apiKey.findFirst({
    where: { id: keyId, organizationId, revokedAt: null },
    select: { keyHash: true },
  });
  if (!row) throw ApiError.notFound("Unknown API key");

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
  // Immediate on this replica; others catch up within CACHE_MS.
  cache.delete(row.keyHash);
}
