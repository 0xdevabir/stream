#!/usr/bin/env node
/**
 * LMS-side integration sketch:
 *   1. Create a live input with the provider API key
 *   2. Hand OBS credentials to the instructor
 *   3. Mint a viewer token after your own enrollment check
 *   4. Serve an HTML page that plays via hls.js + Authorization header
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.STREAM_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const apiKey = process.env.STREAM_API_KEY;

if (!apiKey) {
  console.error("Set STREAM_API_KEY (see ../../.seed-output.json after pnpm db:seed)");
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  return data;
}

const live = await api("POST", "/v1/provider/live_inputs", {
  name: "LMS Demo Class",
  record: true,
  metadata: { courseId: "cs101" },
});

console.log("Live input created:", live.id);
console.log("OBS server:", live.ingest.rtmp.url);
console.log("OBS stream key:", live.ingest.rtmp.streamKey);

const token = await api("POST", `/v1/provider/live_inputs/${live.id}/token`, {
  ttlSeconds: 3600,
});

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>${live.name}</title>
<body style="font-family: system-ui; max-width: 960px; margin: 2rem auto;">
  <h1>${live.name}</h1>
  <p>Status: <strong id="status">${live.status}</strong> — publish with OBS, then refresh if needed.</p>
  <video id="video" controls autoplay playsinline style="width:100%;background:#111"></video>
  <script type="module">
    import Hls from "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.mjs";
    const signedUrl = ${JSON.stringify(token.signedHlsUrl)};
    const fallback = ${JSON.stringify(token.hlsUrl)};
    const tok = ${JSON.stringify(token.token)};
    const video = document.getElementById("video");
    const src = signedUrl || (fallback ? fallback + "?token=" + encodeURIComponent(tok) : null);
    if (!src) {
      document.getElementById("status").textContent = "SCHEDULED (waiting for publisher)";
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        xhrSetup(xhr) {
          xhr.setRequestHeader("Authorization", "Bearer " + tok);
        },
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }
  </script>
</body>
</html>
`;

const out = resolve(dirname(fileURLToPath(import.meta.url)), "player.html");
writeFileSync(out, html);
console.log("Wrote", out);
console.log("Playback token expires at", token.expiresAt);
