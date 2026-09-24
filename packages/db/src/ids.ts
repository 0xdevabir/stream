import { createHash, randomBytes } from "node:crypto";

/**
 * Identifier and secret generation.
 *
 * Everything here is base64url so the values can be dropped straight into URLs,
 * filesystem paths, and RTMP stream keys without escaping -- see
 * `assertSafeId` in `@stream/shared/paths`, which these must satisfy.
 */

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

/** Ingest credential handed to OBS. Shown once, stored only as a hash. */
export function generateStreamKey(): string {
  return `sk_${randomBytes(24).toString("base64url")}`;
}

/** First characters of a stream key, kept in the clear so the UI can show it. */
export function streamKeyPrefix(streamKey: string): string {
  return streamKey.slice(0, 11);
}

/**
 * Stream keys are high-entropy random strings, not user-chosen passwords, so a
 * plain SHA-256 is the right tool: there is nothing to brute-force, and the
 * ingest auth hook is on the hot path for every publish attempt.
 */
export function hashStreamKey(streamKey: string): string {
  return createHash("sha256").update(streamKey).digest("hex");
}

/** Unguessable component of a LINK-mode share URL. */
export function generateShareToken(): string {
  return randomBytes(18).toString("base64url");
}

/** Opaque public identifier for a stream's HLS content key. */
export function generateContentKeyId(): string {
  return `k_${randomBytes(12).toString("base64url")}`;
}

/** Truncated IP hash: enough to correlate abuse, not enough to identify. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** URL-safe slug with a short random suffix to guarantee uniqueness. */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = randomBytes(3).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

/**
 * Developer API key. The `stm_live_` prefix makes a leaked key recognisable to
 * secret scanners and to humans reading a log. Like stream keys it is random,
 * so a plain SHA-256 (`hashStreamKey`) is the right way to store it.
 */
export const API_KEY_PREFIX = "stm_live_";

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

/** Non-secret head of an API key, shown in the dashboard to tell keys apart. */
export function apiKeyDisplayPrefix(apiKey: string): string {
  return apiKey.slice(0, API_KEY_PREFIX.length + 6);
}

/** HMAC secret handed to a webhook receiver once, at creation. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}
