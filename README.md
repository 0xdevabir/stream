# Stream

Self-hosted **live + VOD streaming provider** (Cloudflare Stream–style): tenants
create live inputs via API or the developer console, publish with OBS/RTMP/SRT/WHIP,
and deliver AES-128 HLS through nginx + CDN with signed playback tokens.

End viewers watch inside your LMS or app — not on this site. The web UI is a
**tenant developer console**.

```bash
pnpm setup && pnpm up && pnpm db:seed
open http://localhost:8080          # console@example.com / changeme-please
```

## What it does

- **Provider API** — `/v1/provider/*` with API keys for LMS integrations (live
  inputs, tokens, videos, webhooks, usage).
- **Developer console** — cookie-auth `/v1/console/*` for the same operations
  in the browser: overview, live inputs, videos, API keys, webhooks, usage,
  embed/test player.
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
apps/web          Next.js: tenant developer console
packages/db       Prisma schema, envelope encryption, seed
packages/shared   zod contracts, ladder, canonical media paths
infra/            compose, mediamtx.yml, nginx, CDN worker, Dockerfiles
scripts/          smoke publisher, verifier, create-tenant, load-test
```

## Console quick start

1. Seed → sign in as `console@example.com` / `changeme-please`.
2. Create a **live input**, copy RTMP/SRT/WHIP ingest credentials.
3. Publish from OBS; mint a playback token; preview on the input page or `/embed`.
4. Create an **API key** and call `/v1/provider/*` from your LMS.

Self-serve signup is disabled; tenants are created by an operator (seed or
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
- [Embed / LMS](docs/embed.md) — signed playback tokens for third-party players

## Not included

Billing UI, multi-region edge federation, DRM, native mobile apps, DVR scrubbing
during live, simulcast to social networks.
