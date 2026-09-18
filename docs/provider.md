# Streaming provider (single-region)

This platform runs as a **Cloudflare Stream–style live + VOD API**: tenants
create live inputs with API keys or the developer console, viewers play via
signed tokens, recordings land in object storage, and a CDN fronts HLS delivery.

Students never visit this site — they watch inside the LMS player. See
[embed.md](embed.md) for LMS integration.

## Planes

| Plane | Components | Public? |
|---|---|---|
| Control | API replicas, Postgres, Redis | API LB (`/v1/provider/*`); console cookies (`/v1/console/*`) |
| Media | MediaMTX, transcoder workers, origin nginx, live volume | Ingest ports + origin (CDN only) |
| Delivery | CDN → origin `/hls` `/vod` `/v1/keys` | CDN HTTPS |
| Console | Next.js at `/` | Tenant owners/admins only |

## Production checklist (Phase 0)

1. **TLS** — terminate HTTPS on a load balancer or CDN; set
   `PUBLIC_BASE_URL=https://stream.example.com`.
2. **Managed Postgres / Redis** — point `DATABASE_URL` and `REDIS_URL` at
   private endpoints. Do not publish their ports.
3. **Object storage** — use S3 / R2 / B2; drop local MinIO in compose. Keep
   `S3_FORCE_PATH_STYLE` correct for the vendor.
4. **CDN** — put Cloudflare or Bunny in front of the origin. Cache `.ts`
   aggressively; keep `.m3u8` short TTL. See [cdn/](../infra/cdn/) for a
   Worker that validates playback JWTs before origin fetch.
5. **Secrets** — `pnpm setup` / `node scripts/gen-secrets.mjs --force`. Back up
   `CONTENT_KEY_SECRET` separately from the database.
6. **Ingest** — expose RTMP `1935`, SRT `8890/udp`, WebRTC ICE `8189` only if
   publishers need them; set `WEBRTC_ADDITIONAL_HOSTS` to the public hostname.
7. **Quality defaults** — `LADDER=1080p,720p,480p,360p`,
   `HLS_SEGMENT_SECONDS=1`, latency mode `LOW` for large audiences.

## Capacity (one region)

- Encode cost scales with **concurrent live inputs**, not viewers.
- Viewer cost is **CDN egress** (~1–1.5 Mbps average ABR per viewer).
- 500 viewers ≈ 500–750 Mbps through the CDN for one popular stream.
- Start: 8 vCPU / 16 GB origin box for a few concurrent 720p ladders; add
  transcoder workers as concurrent lives grow (`REDIS` encode leases).

## Load test

```bash
# With a live input playing and a playback token:
node scripts/load-test-hls.mjs --url 'https://origin/hls/<id>/master.m3u8?token=...' --viewers 500
```

## Provider API (summary)

| Method | Path | Auth |
|---|---|---|
| `POST` | `/v1/provider/live_inputs` | API key |
| `GET` | `/v1/provider/live_inputs/:id` | API key |
| `POST` | `/v1/provider/live_inputs/:id/token` | API key |
| `DELETE` | `/v1/provider/live_inputs/:id` | API key |
| `GET` | `/v1/provider/videos/:id` | API key |
| `GET` | `/v1/provider/usage` | API key |
| `POST` | `/v1/provider/webhooks` | API key |

Webhook events: `live.started`, `live.ended`, `video.ready`, `video.failed`.

Playback for embeds uses a **signed JWT** (`token` query param or
`Authorization: Bearer`). Cookies still work for same-origin apps.

## Developer console

| Panel | URL | Seed login |
|---|---|---|
| Super admin | `/admin` | `admin@example.com` / `changeme-please` |
| Tenant / consumer | `/dashboard` | `console@example.com` / `changeme-please` |
| Integration guide | `/guides/integration` | public |

Cookie APIs: `/v1/admin/*` (platform), `/v1/console/*` (tenant). Create tenants
in the super-admin UI or:

```bash
pnpm exec tsx scripts/create-tenant.ts --name "Acme LMS"
```

Self-serve signup is not enabled.



