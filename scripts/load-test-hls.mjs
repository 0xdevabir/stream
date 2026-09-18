#!/usr/bin/env node
/**
 * Concurrent HLS playlist poller — approximates N viewers hitting the CDN/origin.
 *
 *   node scripts/load-test-hls.mjs \
 *     --url 'http://localhost:8080/hls/<streamId>/master.m3u8?token=...' \
 *     --viewers 500 \
 *     --seconds 60
 *
 * Does not decode media; it measures auth + playlist/segment fetch success rates
 * under concurrency, which is what breaks first on a misconfigured edge.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    viewers: { type: "string", default: "50" },
    seconds: { type: "string", default: "30" },
    interval: { type: "string", default: "2000" },
  },
});

if (!values.url) {
  console.error("Usage: node scripts/load-test-hls.mjs --url <master.m3u8> [--viewers 500]");
  process.exit(1);
}

const masterUrl = values.url;
const viewers = Number(values.viewers);
const durationMs = Number(values.seconds) * 1000;
const intervalMs = Number(values.interval);

const stats = {
  ok: 0,
  fail: 0,
  status: /** @type {Record<number, number>} */ ({}),
  bytes: 0,
  latencies: /** @type {number[]} */ ([]),
};

async function oneViewer(id) {
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const started = performance.now();
    try {
      const res = await fetch(masterUrl, {
        headers: { "User-Agent": `stream-loadtest/${id}` },
      });
      const body = await res.arrayBuffer();
      const ms = performance.now() - started;
      stats.latencies.push(ms);
      stats.bytes += body.byteLength;
      stats.status[res.status] = (stats.status[res.status] ?? 0) + 1;
      if (res.ok) {
        stats.ok += 1;
        const text = new TextDecoder().decode(body);
        const variant = text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith("#"));
        if (variant) {
          const variantUrl = new URL(variant, masterUrl).toString();
          const vRes = await fetch(variantUrl, {
            headers: { "User-Agent": `stream-loadtest/${id}` },
          });
          await vRes.arrayBuffer();
          stats.status[vRes.status] = (stats.status[vRes.status] ?? 0) + 1;
          if (vRes.ok) stats.ok += 1;
          else stats.fail += 1;
        }
      } else {
        stats.fail += 1;
      }
    } catch {
      stats.fail += 1;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

console.log(
  `load-test: ${viewers} viewers for ${values.seconds}s → ${masterUrl.slice(0, 80)}…`,
);

const started = Date.now();
await Promise.all(Array.from({ length: viewers }, (_, i) => oneViewer(i)));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(
  JSON.stringify(
    {
      elapsedSec: Number(elapsed),
      viewers,
      ok: stats.ok,
      fail: stats.fail,
      status: stats.status,
      bytes: stats.bytes,
      latencyMs: {
        p50: Math.round(percentile(stats.latencies, 50)),
        p95: Math.round(percentile(stats.latencies, 95)),
        p99: Math.round(percentile(stats.latencies, 99)),
      },
    },
    null,
    2,
  ),
);

process.exit(stats.fail > stats.ok ? 1 : 0);
