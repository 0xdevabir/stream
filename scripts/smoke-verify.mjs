#!/usr/bin/env node
/**
 * End-to-end assertions against a running stack.
 *
 * Run `node scripts/smoke-stream.mjs` in one terminal, give it ~15 seconds to
 * fill the ladder, then run this. It checks the properties that actually
 * matter and are easy to break silently:
 *
 *   - the multivariant playlist advertises the whole ladder
 *   - segments are AES-128 encrypted and name a key URI
 *   - an unauthenticated viewer gets 401 on playlists, segments and keys
 *   - an authorized viewer gets 200 on all three
 *   - a viewer authorized for one class cannot read another class's key
 *
 *   node scripts/smoke-verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = env("PUBLIC_BASE_URL", "http://localhost:8080").replace(/\/+$/, "");

const seed = readSeed();
const smoke = seed.smokeStream;
const upcoming = seed.upcomingStream;
const login = seed.logins?.instructor;

let failures = 0;

// `main` runs at the bottom of this file: class declarations are not hoisted,
// so calling it here would hit `CookieJar` before its definition is evaluated.

async function main() {
  console.log(`verify: target ${BASE}\n`);

  const masterPath = `/hls/${smoke.id}/master.m3u8`;

  // ── Anonymous ────────────────────────────────────────────────────────────

  const anonMaster = await fetch(`${BASE}${masterPath}`, { redirect: "manual" });
  check(
    "master playlist is refused without a playback cookie",
    anonMaster.status === 401 || anonMaster.status === 403,
    `got ${anonMaster.status}`,
  );

  const anonKey = await fetch(`${BASE}/v1/keys/${smoke.contentKeyId}`, {
    redirect: "manual",
  });
  check(
    "AES key endpoint is refused without a playback cookie",
    anonKey.status === 401 || anonKey.status === 403,
    `got ${anonKey.status}`,
  );

  // ── Authorized ───────────────────────────────────────────────────────────

  const jar = new CookieJar();

  const loginResponse = await jar.fetch(`${BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: login.email, password: login.password }),
  });
  if (!check("instructor can sign in", loginResponse.ok, `got ${loginResponse.status}`)) {
    return;
  }

  const grantResponse = await jar.fetch(`${BASE}/v1/streams/${smoke.id}/playback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  // Read the body once: `check`'s arguments are evaluated eagerly, so passing
  // `await response.text()` as the failure detail would consume it even when
  // the check passes and leave nothing to parse.
  const grantBody = await safeText(grantResponse, 4096);

  if (
    !check(
      "playback grant is issued",
      grantResponse.ok,
      `got ${grantResponse.status}: ${grantBody.slice(0, 200)}`,
    )
  ) {
    return;
  }

  const grant = JSON.parse(grantBody);
  check("grant reports the class LIVE", grant.status === "LIVE", `got ${grant.status}`);
  if (!grant.hlsUrl) {
    fail("grant has no HLS URL — is the publisher running? (scripts/smoke-stream.mjs)");
    return;
  }

  const master = await jar.fetch(`${BASE}${grant.hlsUrl}`);
  if (!check("master playlist is served to an authorized viewer", master.ok, `got ${master.status}`)) {
    return;
  }

  const masterBody = await master.text();
  const variants = [...masterBody.matchAll(/^#EXT-X-STREAM-INF:(.*)$/gm)];
  check(
    `master lists at least 3 renditions (found ${variants.length})`,
    variants.length >= 3,
    masterBody.slice(0, 400),
  );
  check(
    "every variant declares BANDWIDTH, RESOLUTION and CODECS",
    variants.every(
      (match) =>
        /BANDWIDTH=/.test(match[1]) &&
        /RESOLUTION=/.test(match[1]) &&
        /CODECS="/.test(match[1]),
    ),
    masterBody.slice(0, 400),
  );

  // ── A variant playlist, its key, and a segment ───────────────────────────

  const variantRelative = masterBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  if (!variantRelative) {
    fail("master playlist contains no variant URI");
    return;
  }

  const variantUrl = new URL(variantRelative, `${BASE}${grant.hlsUrl}`).toString();
  const variant = await jar.fetch(variantUrl);
  check("variant playlist is served", variant.ok, `got ${variant.status}`);

  const variantBody = await variant.text();

  const keyLine = /#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/.exec(variantBody);
  check("segments are AES-128 encrypted", Boolean(keyLine), variantBody.slice(0, 300));

  // ffmpeg pins one IV for the whole run; if the key info file does not supply
  // one it silently uses all zeroes. Catching that regression is the point of
  // this assertion.
  const iv = /#EXT-X-KEY:[^\n]*IV=0x([0-9a-fA-F]{32})/.exec(variantBody);
  check("the playlist pins an IV", Boolean(iv), variantBody.slice(0, 300));
  check(
    "the IV is not the all-zero default",
    iv ? !/^0{32}$/.test(iv[1]) : false,
    iv ? `IV=0x${iv[1]}` : "no IV found",
  );

  if (keyLine?.[1]) {
    const keyUrl = new URL(keyLine[1], variantUrl).toString();
    const key = await jar.fetch(keyUrl);
    check("authorized viewer can fetch the AES key", key.ok, `got ${key.status}`);
    if (key.ok) {
      const bytes = new Uint8Array(await key.arrayBuffer());
      check("AES key is 16 bytes", bytes.length === 16, `got ${bytes.length}`);
    }
  }

  const segmentRelative = variantBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  if (segmentRelative) {
    const segmentUrl = new URL(segmentRelative, variantUrl).toString();

    const authorized = await jar.fetch(segmentUrl);
    check("authorized viewer can fetch a segment", authorized.ok, `got ${authorized.status}`);

    const anonymous = await fetch(segmentUrl, { redirect: "manual" });
    check(
      "the same segment is refused without the cookie",
      anonymous.status === 401 || anonymous.status === 403,
      `got ${anonymous.status}`,
    );
  } else {
    fail("variant playlist lists no segments yet — give the publisher a few seconds");
  }

  // ── Cross-class isolation ────────────────────────────────────────────────

  if (upcoming?.id) {
    const other = await jar.fetch(`${BASE}/hls/${upcoming.id}/master.m3u8`, {
      redirect: "manual",
    });
    check(
      "a grant for one class does not unlock another class's media",
      other.status !== 200,
      `got ${other.status}`,
    );
  }

  console.log(
    `\nverify: ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`,
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Node's fetch does not keep cookies, and the whole design hangs on cookie
 * propagation, so the jar is the point rather than an implementation detail.
 */
class CookieJar {
  #cookies = new Map();

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorb(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (index <= 0 || !pair) continue;
      this.#cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  async fetch(url, init = {}) {
    const headers = new Headers(init.headers);
    const cookie = this.header();
    if (cookie) headers.set("Cookie", cookie);

    // Double-submit CSRF: the browser copies the readable cookie into a
    // header, and so must this client.
    const csrf = this.#cookies.get("csrf");
    if (csrf && init.method && init.method !== "GET") {
      headers.set("X-CSRF-Token", csrf);
    }

    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    this.absorb(response);
    return response;
  }
}

function check(label, passed, detail) {
  if (passed) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`       ${String(detail).replace(/\n/g, "\n       ")}`);
  }
  return passed;
}

function fail(message) {
  failures += 1;
  console.log(`  FAIL ${message}`);
}

async function safeText(response, limit = 200) {
  try {
    return (await response.text()).slice(0, limit);
  } catch {
    return "";
  }
}

function readSeed() {
  try {
    return JSON.parse(readFileSync(resolve(REPO_ROOT, ".seed-output.json"), "utf8"));
  } catch {
    console.error("verify: could not read `.seed-output.json`. Run `pnpm db:seed`.");
    process.exit(1);
  }
}

function env(name, fallback) {
  if (process.env[name]) return process.env[name];
  try {
    const text = readFileSync(resolve(REPO_ROOT, ".env"), "utf8");
    const match = new RegExp(`^${name}=(.*)$`, "m").exec(text);
    return match?.[1]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

await main();
process.exit(failures === 0 ? 0 : 1);
