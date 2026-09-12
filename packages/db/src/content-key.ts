import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * HLS content keys at rest.
 *
 * Each stream gets a 16-byte AES-128 key that encrypts its media segments.
 * Storing that key in plaintext next to the segments would make the whole
 * exercise pointless, so it is wrapped with AES-256-GCM under
 * `CONTENT_KEY_SECRET` before it touches Postgres. A stolen database dump is
 * then not sufficient to decrypt a recording; the attacker also needs the
 * application secret.
 *
 * Wire format: [12-byte IV][16-byte GCM tag][ciphertext]
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Node's `Buffer` is typed as `Buffer<ArrayBufferLike>`, but Prisma's `Bytes`
 * columns want `Uint8Array<ArrayBuffer>` -- a Buffer could in principle be
 * backed by a SharedArrayBuffer. Copying into a plain Uint8Array satisfies the
 * type and detaches the value from Node's pooled allocator, so a later write
 * to the pool cannot corrupt bytes we are about to persist.
 */
function toBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

/** AES-128 -- the key length HLS's EXT-X-KEY METHOD=AES-128 mandates. */
export const CONTENT_KEY_LENGTH = 16;

function loadSecret(secretHex: string): Buffer {
  const key = Buffer.from(secretHex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "CONTENT_KEY_SECRET must be 32 bytes of hex (64 characters). " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return key;
}

export function generateContentKey(): Buffer {
  return randomBytes(CONTENT_KEY_LENGTH);
}

/**
 * Same envelope, used for stream keys rather than content keys.
 *
 * Stream keys must be *recoverable* (an instructor reopening the OBS panel
 * expects to see the same key), so they cannot be hashed the way a password
 * would be. Wrapping them means a database dump alone does not hand an
 * attacker the ability to hijack an ingest.
 */
export function wrapSecret(
  plaintext: string,
  secretHex: string,
): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", loadSecret(secretHex), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return toBytes(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

export function unwrapSecret(wrapped: Uint8Array, secretHex: string): string {
  if (wrapped.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Wrapped secret is truncated");
  }
  const iv = wrapped.subarray(0, IV_LENGTH);
  const tag = wrapped.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = wrapped.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", loadSecret(secretHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function wrapContentKey(
  contentKey: Buffer,
  secretHex: string,
): Uint8Array<ArrayBuffer> {
  if (contentKey.length !== CONTENT_KEY_LENGTH) {
    throw new Error(`Content key must be ${CONTENT_KEY_LENGTH} bytes`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", loadSecret(secretHex), iv);
  const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  return toBytes(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

/** Returns a Buffer: callers need `.toString("hex")` to hand the key to ffmpeg. */
export function unwrapContentKey(
  wrapped: Uint8Array,
  secretHex: string,
): Buffer {
  if (wrapped.length < IV_LENGTH + TAG_LENGTH + CONTENT_KEY_LENGTH) {
    throw new Error("Wrapped content key is truncated");
  }
  const iv = wrapped.subarray(0, IV_LENGTH);
  const tag = wrapped.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = wrapped.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", loadSecret(secretHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
