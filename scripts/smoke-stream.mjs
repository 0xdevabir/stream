#!/usr/bin/env node
/**
 * Pushes a synthetic pattern into the seeded smoke live input over RTMP.
 *
 * ffmpeg runs in a throwaway container joined to the compose network, so the
 * host needs nothing installed and the stream reaches MediaMTX by service name
 * rather than through a published port.
 *
 *   node scripts/smoke-stream.mjs [--seconds 120]
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = parseArgs(process.argv.slice(2));
const seconds = Number(args.seconds ?? 300);

const seed = readSeed();
const stream = seed.smokeStream;

if (!stream?.id || !stream?.streamKey) {
  fail("`.seed-output.json` has no smoke stream. Run `pnpm db:seed` first.");
}

// Inside the compose network MediaMTX is reachable as `mediamtx:1935`; the
// path is `live/<streamId>` and the key travels in the query string, exactly
// as an OBS user would configure it.
const target = `rtmp://mediamtx:1935/live/${stream.id}?key=${stream.streamKey}`;

const ffmpegArgs = [
  "-hide_banner",
  "-loglevel",
  "warning",
  "-re",
  "-f",
  "lavfi",
  "-i",
  `testsrc2=size=1280x720:rate=30,drawtext=text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}':fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-th-40`,
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000",
  "-t",
  String(seconds),
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-tune",
  "zerolatency",
  "-profile:v",
  "high",
  "-pix_fmt",
  "yuv420p",
  // One-second GOPs, matching the segment length the transcoder targets.
  "-g",
  "30",
  "-keyint_min",
  "30",
  "-sc_threshold",
  "0",
  "-b:v",
  "3000k",
  "-maxrate",
  "3000k",
  "-bufsize",
  "6000k",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-f",
  "flv",
  target,
];

console.log(`smoke: publishing ${seconds}s of test pattern`);
console.log(`smoke: stream   ${stream.slug} (${stream.id})`);
console.log(`smoke: watch at ${publicBaseUrl()}/watch/${stream.slug}`);

// The transcoder image already carries ffmpeg and already sits on the compose
// network, so `exec` into it rather than pulling a second ffmpeg image. That
// keeps the smoke test dependency-free and version-consistent with production.
const child = spawn(
  "docker",
  [
    "compose",
    "--env-file",
    resolve(REPO_ROOT, ".env"),
    "-f",
    resolve(REPO_ROOT, "infra/docker-compose.yml"),
    "exec",
    "-T",
    "transcoder",
    "ffmpeg",
    ...ffmpegArgs,
  ],
  { stdio: "inherit", cwd: REPO_ROOT },
);

// Ctrl-C should end the broadcast cleanly, which is also the interesting case
// to test: the transcoder must notice and drive PROCESSING -> ENDED.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill("SIGTERM"));
}

child.on("exit", (code) => {
  console.log(`smoke: publisher exited (${code ?? "signal"})`);
  process.exit(code ?? 0);
});

// ── helpers ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token?.startsWith("--")) out[token.slice(2)] = argv[++i];
  }
  return out;
}

function readSeed() {
  try {
    return JSON.parse(readFileSync(resolve(REPO_ROOT, ".seed-output.json"), "utf8"));
  } catch {
    fail("Could not read `.seed-output.json`. Run `pnpm db:seed` first.");
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

function publicBaseUrl() {
  return env("PUBLIC_BASE_URL", "http://localhost:8080");
}

function fail(message) {
  console.error(`smoke: ${message}`);
  process.exit(1);
}

