import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

// tokens.ts reads validated env at import time.
Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://test",
  REDIS_URL: process.env.REDIS_URL ?? "redis://test",
  PUBLIC_BASE_URL: "http://localhost:8080",
  AUTH_SECRET: "a".repeat(40),
  PLAYBACK_SECRET: "p".repeat(40),
  INTERNAL_TOKEN: "i".repeat(20),
  CONTENT_KEY_SECRET: "0".repeat(64),
  S3_ENDPOINT: "http://minio:9000",
  S3_BUCKET: "recordings",
  S3_ACCESS_KEY_ID: "x",
  S3_SECRET_ACCESS_KEY: "x",
});

let tokens: typeof import("./tokens");
before(async () => {
  tokens = await import("./tokens");
});

describe("embed tokens", () => {
  const claims = { streamId: "stream_1", organizationId: "org_1" };

  it("round-trips its claims", async () => {
    const { token, expiresAt } = await tokens.signEmbedToken(claims, 600);
    assert.deepEqual(await tokens.verifyEmbedToken(token), claims);
    assert.ok(Math.abs(expiresAt.getTime() - (Date.now() + 600_000)) < 2_000);
  });

  it("is not accepted as a playback token, nor vice versa", async () => {
    const { token: embed } = await tokens.signEmbedToken(claims, 600);
    assert.equal(await tokens.verifyPlaybackToken(embed), null);

    const { token: playback } = await tokens.signPlaybackToken({
      userId: null,
      streamId: "stream_1",
      scope: "live",
    });
    assert.equal(await tokens.verifyEmbedToken(playback), null);
  });

  it("rejects a tampered token", async () => {
    const { token } = await tokens.signEmbedToken(claims, 600);
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), sid: "other" }),
    ).toString("base64url");
    assert.equal(await tokens.verifyEmbedToken(`${header}.${forged}.${signature}`), null);
  });
});
