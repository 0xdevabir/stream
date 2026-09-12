import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id at the OWASP-recommended baseline (19 MiB, 2 iterations, 1 lane).
 *
 * Parameters live with the persistence layer rather than the API so that the
 * seed script, any future migration job, and the login path can never disagree
 * about how a stored hash was produced.
 *
 * `algorithm` is intentionally omitted: @node-rs/argon2 defaults to Argon2id,
 * and its `Algorithm` enum is an ambient const enum that cannot be referenced
 * under `isolatedModules`. `password.test.ts` asserts the produced hash really
 * carries the `$argon2id$` prefix, which is a stronger check than the literal.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed hash, so a corrupted row
 * fails closed as "wrong password" instead of 500-ing the login endpoint.
 */
export async function verifyPassword(
  storedHash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Argon2 is deliberately slow, which makes "does this email exist?" observable
 * through response timing. Call this on the miss path so both branches burn a
 * comparable amount of CPU.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c3RyZWFtZHVtbXlzYWx0$LMhOnCXHBGDMwvHNQqQwWJf9CQzWZBQTBHCLQPnhJKE";

export async function burnPasswordTiming(plaintext: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plaintext);
}
