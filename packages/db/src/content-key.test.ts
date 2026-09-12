import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import {
  CONTENT_KEY_LENGTH,
  generateContentKey,
  unwrapContentKey,
  unwrapSecret,
  wrapContentKey,
  wrapSecret,
} from "./content-key";
import { hashPassword, verifyPassword } from "./password";

const SECRET = randomBytes(32).toString("hex");
const OTHER_SECRET = randomBytes(32).toString("hex");

describe("content key wrapping", () => {
  it("round-trips an AES-128 content key", () => {
    const key = generateContentKey();
    assert.equal(key.length, CONTENT_KEY_LENGTH);

    const wrapped = wrapContentKey(key, SECRET);
    assert.deepEqual(unwrapContentKey(wrapped, SECRET), key);
  });

  it("produces different ciphertext each time for the same key", () => {
    const key = generateContentKey();
    // A fresh IV per wrap: identical ciphertext would leak that two classes
    // share a content key.
    assert.notDeepEqual(
      Buffer.from(wrapContentKey(key, SECRET)),
      Buffer.from(wrapContentKey(key, SECRET)),
    );
  });

  it("refuses to unwrap under a different secret", () => {
    const wrapped = wrapContentKey(generateContentKey(), SECRET);
    // GCM authentication is what makes this a hard failure rather than
    // silently returning garbage that would corrupt every segment.
    assert.throws(() => unwrapContentKey(wrapped, OTHER_SECRET));
  });

  it("detects tampering with the ciphertext", () => {
    const wrapped = wrapContentKey(generateContentKey(), SECRET);
    wrapped[wrapped.length - 1] ^= 0xff;
    assert.throws(() => unwrapContentKey(wrapped, SECRET));
  });

  it("rejects a secret that is not 32 bytes of hex", () => {
    assert.throws(
      () => wrapContentKey(generateContentKey(), "abcd"),
      /64 characters/,
    );
  });

  it("rejects a truncated payload", () => {
    assert.throws(() => unwrapContentKey(new Uint8Array(4), SECRET), /truncated/);
  });
});

describe("stream key wrapping", () => {
  it("round-trips a stream key", () => {
    const streamKey = "sk_abcdefghijklmnopqrstuvwxyz0123456789";
    const wrapped = wrapSecret(streamKey, SECRET);
    assert.equal(unwrapSecret(wrapped, SECRET), streamKey);
  });

  it("refuses to unwrap under a different secret", () => {
    const wrapped = wrapSecret("sk_something", SECRET);
    assert.throws(() => unwrapSecret(wrapped, OTHER_SECRET));
  });
});

describe("password hashing", () => {
  it("uses argon2id", async () => {
    // Guards the `algorithm`-less OPTIONS in password.ts: if the library ever
    // changed its default away from Argon2id, this fails immediately.
    const hash = await hashPassword("correct-horse-battery");
    assert.ok(
      hash.startsWith("$argon2id$"),
      `expected an argon2id hash, got ${hash.slice(0, 20)}`,
    );
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct-horse-battery");
    assert.equal(await verifyPassword(hash, "correct-horse-battery"), true);
    assert.equal(await verifyPassword(hash, "incorrect-horse"), false);
  });

  it("returns false rather than throwing on a corrupted hash", async () => {
    assert.equal(await verifyPassword("not-a-hash", "anything"), false);
  });
});
