# Live Classes

A self-hosted, low-latency, encrypted live-streaming platform for teaching.
Instructors broadcast from a browser or from OBS; students watch on any device
with adaptive quality; every class is recorded and replayable.

Built to replace a hosted video platform's per-minute delivery bill with plain
nginx bandwidth. Transcoding happens once per class; the thousandth viewer
costs the same as the first.

```bash
pnpm setup && pnpm up && pnpm db:seed
open http://localhost:8080          # instructor@example.com / changeme-please
```

## What it does

- **One-click live streaming** — the instructor presses Go Live in the browser
  (WebRTC/WHIP); students just open a link. OBS and hardware encoders work too,
  over RTMP or SRT with a stream key.
- **Adaptive quality** — a GOP-aligned 1080p/720p/480p/360p ladder built by a
  single ffmpeg process, so switching rungs never stalls. The ladder never
  upscales a lower-resolution source.
- **Low latency** — ~3 seconds glass-to-glass on the HLS path, or sub-second
  over WebRTC for classes that opt into `ULTRA` mode.
- **Encrypted delivery** — AES-128 encrypted segments; keys are served only to
  authenticated viewers holding a live playback session. See
  [docs/security.md](docs/security.md), which is specific about what that does
  and does not protect.
- **Access control** — public, private link, password, enrolled students, or
  organization-wide. All five resolved by one function, one test matrix.
- **Automatic recording** — the replay reuses the live segments, so recording
  costs essentially nothing and is ready seconds after the class ends.
- **Live chat and Q&A** — upvoted questions, pinning, moderation, slow mode,
  fanned out over Redis so it works with any number of API instances.
- **Teacher dashboard** — schedule classes, manage the roster, watch viewer
  count and the quality distribution live, browse recordings.
- **Web-first** — nothing to install for students, works on phones, and iOS
  Safari's native HLS player is supported without a custom loader.

## Layout

```
apps/api          Fastify: auth, access control, key delivery, chat, hooks
apps/transcoder   ffmpeg supervisor + recording/VOD worker
apps/web          Next.js: player, studio, dashboard, replay library
packages/db       Prisma schema, envelope encryption, seed
packages/shared   zod contracts, WS protocol, ladder, canonical media paths
infra/            compose, mediamtx.yml, nginx, Dockerfiles
scripts/          smoke publisher and end-to-end verifier
```

## Verifying it works

```bash
node scripts/smoke-stream.mjs --seconds 120   # publish a synthetic lecture
node scripts/smoke-verify.mjs                 # assert the whole chain
pnpm test && pnpm typecheck
```

The test pattern carries a burned-in clock, so you can read glass-to-glass
latency by putting the browser next to the terminal.

## Docs

- [Architecture](docs/architecture.md) — how it fits together and why
- [Deploying and operating](docs/deploy.md) — single-box guide, tuning, sizing
- [Security model](docs/security.md) — including what is *not* protected
- [Streaming provider](docs/provider.md) — multi-tenant live+VOD API (Cloudflare Stream–style)
- [Embed / LMS](docs/embed.md) — signed playback tokens for third-party players

## Not included

Billing, multi-region edge federation, native mobile apps, DVR scrubbing during
a live class, simulcast to YouTube/Facebook, and deep retention analytics. The
schema and edge layer leave room for each.

