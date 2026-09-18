# Stream

Self-hosted **live + VOD streaming provider** (Cloudflare Stream–style): tenants
create live inputs via API or the developer console, publish with OBS/RTMP/SRT/WHIP,
and deliver AES-128 HLS through nginx + CDN with signed playback tokens.

End viewers watch inside your LMS or app — not on this site. The web UI has a
**super-admin panel** (all tenants) and a **tenant / consumer console** (one
customer’s live inputs, keys, and embed tools).

```bash
pnpm setup && pnpm up && pnpm db:seed
open http://localhost:8080          # admin@example.com or console@example.com / changeme-please
```

## What it does

- **Provider API** — `/v1/provider/*` with API keys for LMS integrations (live
  inputs, tokens, videos, webhooks, usage).
- **Super admin** — `/admin` + `/v1/admin/*` to create tenants and set quotas.
- **Tenant / consumer console** — `/dashboard` + `/v1/console/*` for live
  inputs, videos, API keys, webhooks, usage, embed/test player.
- **Integration guide** — `/guides/integration` and `docs/integration.md`.
- **Adaptive quality** — GOP-aligned 1080p/720p/480p/360p ladder from one ffmpeg
  process; never upscales a lower-resolution source.
- **Low latency** — ~3s glass-to-glass HLS, or sub-second WebRTC (`ULTRA`).
- **Encrypted delivery** — AES-128 segments; keys only for valid playback
  sessions. See [docs/security.md](docs/security.md).
- **Automatic recording** — VOD reuses live segments; ready soon after end.
- **Multi-tenant** — quotas, API keys, webhooks per tenant. Provision with
  `pnpm db:seed` or `pnpm exec tsx scripts/create-tenant.ts --name "Acme"`.

## Layout

```
apps/api          Fastify: provider + console APIs, auth, keys, hooks
apps/transcoder   ffmpeg supervisor + recording/VOD worker
apps/web          Next.js: super-admin + tenant console + integration guide
packages/db       Prisma schema, envelope encryption, seed
packages/shared   zod contracts, ladder, canonical media paths
infra/            compose, mediamtx.yml, nginx, CDN worker, Dockerfiles
scripts/          smoke publisher, verifier, create-tenant, load-test
```

## Console quick start

1. Seed → sign in:
   - **Super admin:** `admin@example.com` / `changeme-please` → `/admin`
   - **Tenant console:** `console@example.com` / `changeme-please` → `/dashboard`
2. (Admin) Create tenants and set quotas; (Tenant) create a live input, copy ingest, mint a token.
3. Create an **API key** and call `/v1/provider/*` from your LMS.
4. Read the [integration guide](/guides/integration) (also `docs/integration.md`).

Self-serve signup is disabled; tenants are created by a platform admin (or
`scripts/create-tenant.ts`).

## Verifying it works

```bash
node scripts/smoke-stream.mjs --seconds 120   # publish a synthetic lecture
node scripts/smoke-verify.mjs                 # assert the whole chain
pnpm test && pnpm typecheck
```

## Docs

- [Architecture](docs/architecture.md) — how it fits together and why
- [Deploying and operating](docs/deploy.md) — single-box guide, tuning, sizing
- [Security model](docs/security.md) — including what is *not* protected
- [Streaming provider](docs/provider.md) — multi-tenant live+VOD API
- [Developer integration](docs/integration.md) — LMS wiring (also `/guides/integration`)
- [Embed / LMS](docs/embed.md) — signed playback tokens for third-party players

## Not included

Billing UI, multi-region edge federation, DRM, native mobile apps, DVR scrubbing
during live, simulcast to social networks.

