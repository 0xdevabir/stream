#!/usr/bin/env node
/**
 * End-to-end assertions against a running stack.
 *
 * Run `node scripts/smoke-stream.mjs` in one terminal, give it ~15 seconds to
 * fill the ladder, then run this. It checks:
 *
 *   - the multivariant playlist advertises the whole ladder
 *   - segments are AES-128 encrypted and name a key URI
 *   - an unauthenticated viewer gets 401 on playlists, segments and keys
 *   - an authorized viewer (signed token) gets 200 on all three
 *   - a token for one live input cannot read another input's media
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
const apiKey = seed.provider?.apiKey;

let failures = 0;

async function main() {
  console.log(`verify: target ${BASE}\n`);

  if (!smoke?.id || !smoke?.contentKeyId) {
    fail("`.seed-output.json` missing smokeStream. Run `pnpm db:seed`.");
    return;
  }
  if (!apiKey) {
    fail("`.seed-output.json` missing provider.apiKey. Run `pnpm db:seed`.");
    return;
  }

  const masterPath = `/hls/${smoke.id}/master.m3u8`;

  const anonMaster = await fetch(`${BASE}${masterPath}`, { redirect: "manual" });
  check(
    "master playlist is refused without a playback token",
    anonMaster.status === 401 || anonMaster.status === 403,
    `got ${anonMaster.status}`,
  );

  const anonKey = await fetch(`${BASE}/v1/keys/${smoke.contentKeyId}`, {
    redirect: "manual",
  });
  check(
    "AES key endpoint is refused without a playback token",
    anonKey.status === 401 || anonKey.status === 403,
    `got ${anonKey.status}`,
  );

  const tokenRes = await fetch(
    `${BASE}/v1/provider/live_inputs/${smoke.id}/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttlSeconds: 3600 }),
    },
  );
  const tokenBody = await safeText(tokenRes, 4096);
  if (
    !check(
      "provider mints a playback token",
      tokenRes.ok,
      `got ${tokenRes.status}: ${tokenBody.slice(0, 200)}`,
    )
  ) {
    return;
  }

  const grant = JSON.parse(tokenBody);
  const token = grant.token;
  if (!token) {
    fail("token response missing token");
    return;
  }

  const authed = (path) =>
    fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`, {
      redirect: "manual",
      headers: { Authorization: `Bearer ${token}` },
    });

  const master = await authed(masterPath);
  if (
    !check(
      "master playlist is served with a signed token",
      master.ok,
      `got ${master.status}`,
    )
  ) {
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

  const variantRelative = masterBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  if (!variantRelative) {
    fail("master playlist contains no variant URI");
    return;
  }

  const variantUrl = new URL(variantRelative, `${BASE}${masterPath}`).toString();
  const variant = await fetch(
    `${variantUrl}${variantUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  check("variant playlist is served", variant.ok, `got ${variant.status}`);

  const variantBody = await variant.text();

  const keyLine = /#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/.exec(variantBody);
  check("segments are AES-128 encrypted", Boolean(keyLine), variantBody.slice(0, 300));

  const iv = /#EXT-X-KEY:[^\n]*IV=0x([0-9a-fA-F]{32})/.exec(variantBody);
  check("the playlist pins an IV", Boolean(iv), variantBody.slice(0, 300));
  check(
    "the IV is not the all-zero default",
    iv ? !/^0{32}$/.test(iv[1]) : false,
    iv ? `IV=0x${iv[1]}` : "no IV found",
  );

  if (keyLine?.[1]) {
    const keyUrl = new URL(keyLine[1], variantUrl).toString();
    const key = await fetch(keyUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
    const withTok = `${segmentUrl}${segmentUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;

    const authorized = await fetch(withTok, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check("authorized viewer can fetch a segment", authorized.ok, `got ${authorized.status}`);

    const anonymous = await fetch(segmentUrl, { redirect: "manual" });
    check(
      "the same segment is refused without the token",
      anonymous.status === 401 || anonymous.status === 403,
      `got ${anonymous.status}`,
    );
  } else {
    fail("variant playlist lists no segments yet — give the publisher a few seconds");
  }

  if (upcoming?.id) {
    const other = await fetch(
      `${BASE}/hls/${upcoming.id}/master.m3u8?token=${encodeURIComponent(token)}`,
      { redirect: "manual" },
    );
    check(
      "a token for one live input does not unlock another's media",
      other.status !== 200,
      `got ${other.status}`,
    );
  }

  console.log(
    `\nverify: ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
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
    const text = await response.text();
    return text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return "";
  }
}

function env(name, fallback) {
  return process.env[name] ?? fallback;
}

function readSeed() {
  try {
    return JSON.parse(readFileSync(resolve(REPO_ROOT, ".seed-output.json"), "utf8"));
  } catch {
    console.error("verify: could not read `.seed-output.json`. Run `pnpm db:seed`.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
