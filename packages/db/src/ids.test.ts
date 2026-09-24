import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_KEY_PREFIX,
  apiKeyDisplayPrefix,
  generateApiKey,
  generateWebhookSecret,
  hashStreamKey,
} from "./ids";

test("API keys are prefixed, unique and hash deterministically", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.ok(a.startsWith(API_KEY_PREFIX));
  assert.notEqual(a, b);
  assert.equal(hashStreamKey(a), hashStreamKey(a));
  assert.notEqual(hashStreamKey(a), hashStreamKey(b));
  assert.match(a, /^stm_live_[A-Za-z0-9_-]{32}$/);
});

test("the display prefix never reveals more than 6 secret characters", () => {
  const key = generateApiKey();
  assert.equal(apiKeyDisplayPrefix(key).length, API_KEY_PREFIX.length + 6);
});

test("webhook secrets are whsec_ prefixed", () => {
  assert.match(generateWebhookSecret(), /^whsec_[A-Za-z0-9_-]{32}$/);
});
