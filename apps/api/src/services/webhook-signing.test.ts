import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { isPublicAddress, signWebhookPayload, verifyWebhookSignature } from "./webhook-signing";

const SECRET = "whsec_test";
const BODY = JSON.stringify({ id: "evt_1", type: "stream.live", data: {} });

describe("webhook signatures", () => {
  it("is HMAC-SHA256 over '<t>.<body>', as documented", () => {
    const expected = createHmac("sha256", SECRET).update(`1700000000.${BODY}`).digest("hex");
    assert.equal(signWebhookPayload(SECRET, BODY, 1_700_000_000), `t=1700000000,v1=${expected}`);
  });

  it("round-trips", () => {
    const header = signWebhookPayload(SECRET, BODY);
    assert.ok(verifyWebhookSignature(SECRET, BODY, header));
  });

  it("rejects a tampered body, a wrong secret and a malformed header", () => {
    const header = signWebhookPayload(SECRET, BODY);
    assert.ok(!verifyWebhookSignature(SECRET, `${BODY} `, header));
    assert.ok(!verifyWebhookSignature("whsec_other", BODY, header));
    assert.ok(!verifyWebhookSignature(SECRET, BODY, "garbage"));
    assert.ok(!verifyWebhookSignature(SECRET, BODY, "t=abc,v1=00"));
  });

  it("rejects replays outside the tolerance window", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_000);
    assert.ok(verifyWebhookSignature(SECRET, BODY, header, 300, 1_200));
    assert.ok(!verifyWebhookSignature(SECRET, BODY, header, 300, 1_301));
  });
});

describe("isPublicAddress", () => {
  it("blocks loopback, private, link-local and metadata ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.5",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:1.1.1.1"]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });
});
