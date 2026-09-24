# Developer API

Everything a customer needs to run classes from their own product: create and
manage classes from their backend, embed the player in their site, and react to
lifecycle events. Admins manage credentials at **/developers** in the app.

## Authentication

Create a key at **/developers → API keys**. It is shown once. Send it as a
bearer token:

```
Authorization: Bearer stm_live_…
```

- A key acts as the admin who created it, capped at the `ADMIN` role. It stops
  working when revoked, or when its creator stops being an `ADMIN`/`OWNER` of
  the organization. Revocation reaches every API replica within 30 seconds.
- Only the SHA-256 hash is stored. A lost key cannot be recovered; revoke it
  and create a new one.
- An invalid or revoked key is a hard `401`. The API never falls back to a
  cookie session.
- Keys cannot reach `/v1/auth/*` or `/v1/developer/*` (`403`). A leaked key
  cannot mint more keys, and it cannot read or change webhook configuration.
- CSRF checks do not apply to bearer requests.

### Rate limits

Each key allows 600 requests per minute, in a fixed window. Every response
carries `X-RateLimit-Remaining`, and going over the limit returns `429`. The
per-IP limits on individual routes still apply.

### Errors

```json
{ "error": { "code": "not_found", "message": "Stream not found" } }
```

## Endpoints (with an API key)

All paths are under `/v1`. `:id` accepts a stream id or slug.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/streams` | List classes |
| `POST` | `/streams` | Create a class (`title`, `description?`, `scheduledAt?`, `accessMode`, `password?`, `latencyMode`, `recordEnabled`, `chatEnabled`, `questionsEnabled`) |
| `GET` | `/streams/:id` | Read a class |
| `PATCH` | `/streams/:id` | Update a class |
| `DELETE` | `/streams/:id` | Cancel a class (`409` while live) |
| `POST` | `/streams/:id/end` | End a live class |
| `GET` | `/streams/:id/ingest` | RTMP/SRT credentials for OBS, and the WHIP URL and token for browser publishing |
| `POST` | `/streams/:id/key/rotate` | Rotate the stream key (disconnects a connected encoder) |
| `GET` | `/streams/:id/health` | Encoder connection, protocol, bitrate, tracks and viewer count |
| `GET`/`POST`/`DELETE` | `/streams/:id/enrollments[/:userId]` | Manage enrollments (`ENROLLED` mode) |
| `POST` | `/streams/:id/embed-tokens` | Mint an embed token (see below) |
| `GET` | `/streams/:id/analytics` | Viewer analytics |

`accessMode` is one of `PUBLIC`, `LINK`, `PASSWORD`, `ENROLLED` or `ORG`. The
mode only governs viewers who come through the app. Embeds bypass it, because
your backend has already made the access decision by minting the token.

```bash
curl -X POST https://<host>/v1/streams \
  -H "Authorization: Bearer $STREAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Algebra 101","scheduledAt":"2026-10-01T15:00:00Z"}'
```

## Streaming from OBS

`POST /streams` returns `ingest` with the credentials once; fetch them again
any time with `GET /streams/:id/ingest`.

| OBS field (Settings → Stream → Service: Custom) | Value |
|---|---|
| Server | `ingest.rtmp.url` |
| Stream Key | `ingest.rtmp.streamKey` |

Recommended output settings: H.264, AAC, keyframe interval 1 s (2 s at most),
CBR, up to 6 Mbps for 1080p. For SRT encoders use `ingest.srt.url` as-is.

Poll `GET /streams/:id/health` to confirm the encoder is reaching the server:

```json
{
  "streamId": "…",
  "status": "LIVE",
  "paused": false,
  "viewers": 42,
  "encoder": {
    "connected": true,
    "protocol": "rtmp",
    "connectedAt": "2026-10-01T15:00:02.000Z",
    "tracks": ["H264", "MPEG-4 Audio"],
    "bitrateKbps": 4480,
    "bytesReceived": 183500000
  }
}
```

`encoder.connected` flips as soon as OBS connects; `status` becomes `LIVE`
a few seconds later, once the first segments are ready. If the encoder drops
while live, `paused` is `true` and viewers see "Stream paused" until it
reconnects (within 45 s) or the class ends. `bitrateKbps` is averaged between
polls and is `null` on the first one. Admins see the same readout for every
stream at **/developers → Streams**.

The ingest hostname comes from `INGEST_RTMP_URL` / `INGEST_SRT_HOST`, or the
`PUBLIC_BASE_URL` hostname when those are unset. Port 1935/tcp (RTMP) and
8890/udp (SRT) must be reachable from the encoder.

## Embedding the player

1. When a user opens the class page in your product, your **backend** mints a
   token. Never ship the API key to a browser.

   ```bash
   curl -X POST https://<host>/v1/streams/<id>/embed-tokens \
     -H "Authorization: Bearer $STREAM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"ttlSeconds":7200}'
   # → { "token": "…", "expiresAt": "…", "embedUrl": "https://<host>/embed/<slug>?token=…" }
   ```

   `ttlSeconds` ranges from 60 to 86400 and defaults to 3600. The token only
   needs to be valid when the page loads, because the player renews its own
   session after that. A class can therefore run longer than the token that
   opened it.

2. Render the `embedUrl` in an iframe:

   ```html
   <iframe src="EMBED_URL"
           allow="autoplay; fullscreen; picture-in-picture"
           allowfullscreen
           style="width:100%;aspect-ratio:16/9;border:0"></iframe>
   ```

The embed page behaves like this:

- Before the class starts, it shows a waiting screen and starts playing on its
  own when the class goes live.
- After the class, it switches to the replay once the replay is ready.
- There is no chat.
- It uses no cookies. Its session travels as an `X-Playback-Token` header,
  because browsers block third-party cookies in iframes.

**Browser support:** the embed needs Media Source Extensions: every desktop
browser, Android, and iOS/iPadOS 17.1+ (ManagedMediaSource). Older iPhones get
a clear "update iOS" message, since Safari's native HLS player cannot send
the auth header.

Embedded viewers are anonymous to us. They count toward live viewer numbers,
but they have no per-user analytics and no per-user concurrency limit. If you
need either, create enrollments and send users through the app instead.

## Webhooks

Add an endpoint at **/developers → Webhooks**. The signing secret (`whsec_…`)
is shown once. An organization can have up to 10 endpoints. If you subscribe
to no events, the endpoint receives all of them.

### Events

| Type | When | `data` |
| --- | --- | --- |
| `stream.live` | Media reaches the edge for the first time in a session. Encoder reconnects do not re-send it. | `stream`, `hlsUrl` |
| `stream.ended` | Media stops | `stream`, `recordingExpected` |
| `recording.ready` | The replay is playable | `stream`, `recording { id, status, durationSeconds, vodUrl }` |
| `recording.failed` | Recording processing failed | `stream`, `recording { id, status, durationSeconds, error }` |
| `ping` | You pressed "Send test" | `webhookId` |

`stream` is always `{ id, slug, title, status }`. The URLs are for reference
only: fetching media still requires a playback grant, so use an embed.

```http
POST /your/endpoint
Content-Type: application/json
User-Agent: Stream-Webhooks/1.0
Stream-Event: stream.live
Stream-Delivery: <delivery id>
Stream-Signature: t=1790000000,v1=5f2b…

{"id":"evt_…","type":"stream.live","created":"2026-10-01T15:00:04.000Z",
 "data":{"stream":{"id":"…","slug":"…","title":"Algebra 101","status":"LIVE"},"hlsUrl":"https://…"}}
```

### Verifying signatures

`v1` is the hex HMAC-SHA256 of `"<t>.<raw body>"`, keyed with the endpoint
secret. Always verify against the **raw** request body, before any JSON
parsing, and reject timestamps older than 5 minutes to block replays.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, rawBody, header, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return parts.v1.length === expected.length &&
    timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}
```

The reference implementation is `apps/api/src/services/webhook-signing.ts`.

### Delivery semantics

- **Success:** any `2xx` within 10 seconds. Redirects are not followed and
  count as failures.
- **Retries:** failed deliveries are retried after 30 s, 2 min, 10 min, 30 min,
  2 h, 6 h and 12 h (8 attempts, roughly a day in total), then marked `FAILED`.
  You can retry by hand from the delivery log.
- **At least once:** a delivery can arrive more than once, so deduplicate on
  the event `id` (or `Stream-Delivery`).
- **Ordering:** order is not guaranteed. Use `data.stream.status` and
  `created`, not arrival order.
- **Retention:** delivery logs are kept for 30 days.
- **Production URL rules:** endpoints must use `https` and resolve to public
  addresses. Private, loopback and link-local ranges are refused.

## Management endpoints (browser session only)

Admins use these from `/developers`. They reject API keys.

`GET|POST /v1/developer/api-keys`, `DELETE /v1/developer/api-keys/:id`,
`GET|POST /v1/developer/webhooks`, `PATCH|DELETE /v1/developer/webhooks/:id`,
`POST /v1/developer/webhooks/:id/test`,
`GET /v1/developer/webhooks/:id/deliveries`,
`POST /v1/developer/webhooks/:id/deliveries/:deliveryId/retry`.

## Known limitations

- The webhook SSRF check resolves DNS before connecting, so a hostile DNS
  server could rebind between the check and the connection. Egress firewalling
  of the API host is the complete fix.
- Only one key environment exists (`stm_live_`). There are no test-mode keys.
