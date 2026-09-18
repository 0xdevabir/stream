# Developer integration guide

Wire your LMS (or any backend) to Stream for **live streaming and recording**.
Students never log into Stream — your app mints playback tokens after you check
enrollment.

Also available in the UI: [/guides/integration](/guides/integration).

## Roles

| Role | UI | Auth |
|---|---|---|
| **Super admin** | `/admin` | `platformAdmin` user (seed: `admin@example.com`) |
| **Tenant / consumer** | `/dashboard` … | Org member of a Tenant (seed: `console@example.com`) |
| **LMS backend** | — | API key → `/v1/provider/*` |
| **Student** | Your LMS only | Your session + short-lived playback token |

## Flow

1. Platform admin creates a tenant → API key + console login (once).
2. LMS backend `POST /v1/provider/live_inputs` → store `id` + ingest creds.
3. Instructor publishes via OBS (RTMP/SRT) or WHIP.
4. On “join class”, LMS checks enrollment, then
   `POST /v1/provider/live_inputs/:id/token`.
5. Browser plays `signedHlsUrl` with hls.js (`xhrSetup` for AES keys).

## Minimal curl

```bash
export STREAM_BASE_URL=http://localhost:8080
export STREAM_API_KEY=sk_live_…

curl -sS -X POST "$STREAM_BASE_URL/v1/provider/live_inputs" \
  -H "Authorization: Bearer $STREAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Lecture","record":true}'

curl -sS -X POST "$STREAM_BASE_URL/v1/provider/live_inputs/$ID/token" \
  -H "Authorization: Bearer $STREAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ttlSeconds":3600}'
```

## API surface

| Method | Path |
|---|---|
| `POST` | `/v1/provider/live_inputs` |
| `GET` | `/v1/provider/live_inputs/:id` |
| `POST` | `/v1/provider/live_inputs/:id/token` |
| `DELETE` | `/v1/provider/live_inputs/:id` |
| `GET` | `/v1/provider/videos/:id` |
| `GET` | `/v1/provider/usage` |
| `POST` | `/v1/provider/webhooks` |

Webhook events: `live.started`, `live.ended`, `video.ready`, `video.failed`.

## Localhost note

LMS on another port than Stream is fine. Keep the API key on the server. Align
`PUBLIC_BASE_URL` with the origin browsers use for HLS. See
[embed.md](embed.md) for the player snippet and
[examples/lms-integration](../examples/lms-integration/).
