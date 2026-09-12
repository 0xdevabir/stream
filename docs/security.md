# Security model

This document is deliberately specific about what is and is not protected. A
vague security page is worse than none, because it invites people to assume
more than is true.

## "End-to-end encrypted" — what that can and cannot mean here

**It is not end-to-end encrypted, and no platform that offers adaptive quality
is.** To produce a 360p rendition the server must decode the video. A server
that can decode your video is, by definition, not excluded from it. Anyone
advertising both server-side ABR and true E2EE is describing two things that
cannot both be true.

What is actually delivered — and what every commercial platform means when it
uses the phrase:

| Layer | Protection |
|---|---|
| Instructor → server | TLS (RTMP over TLS / SRT AES / WHIP over HTTPS + DTLS-SRTP) |
| Server → viewer | TLS |
| Media at rest and on the wire | **AES-128 encrypted HLS segments** |
| Key access | Short-lived playback token, checked per request, revocable |
| Delivery | Every playlist, segment and key gated by an `auth_request` |

A segment stolen off disk, out of object storage, or off the wire is a blob of
AES-128 ciphertext. It is useless without the key, and the key is only handed
to a viewer holding a live, unrevoked playback session for that specific class.

**The operator can see everything.** If your threat model includes the person
running the server, this system does not address it.

## Authentication

- **Passwords**: Argon2id, 19 MiB / t=2 / p=1. Login misses burn comparable CPU
  so response timing does not reveal whether an address exists.
- **Sessions**: `HttpOnly` access cookie (15 min) + refresh cookie. Refresh
  tokens are **single-use and rotated**, so a stolen one stops working the
  moment the legitimate client refreshes.
- **CSRF**: double-submit token, compared in constant time. Enforced on every
  unsafe cookie-authenticated request.
- **Cookies**: `SameSite=Lax` (so a class link still works on a top-level
  navigation), `Secure` in production.

## Authorization

Every path that can reveal media resolves access through **one function**,
`apps/api/src/services/access.ts`. There is no second implementation to drift
out of sync, and its five access modes are covered by an exhaustive unit-test
matrix plus a compile-time exhaustiveness guard.

| Mode | Who can watch |
|---|---|
| `PUBLIC` | anyone with the URL |
| `LINK` | anyone holding the unguessable share token |
| `PASSWORD` | anyone who can supply the class password |
| `ENROLLED` | signed-in users on the class roster |
| `ORG` | any signed-in member of the organization |

The instructor and org admins short-circuit to allowed before any of this runs.

**Revocation is immediate, not eventual.** Playback sessions live in Redis;
removing a student from a class deletes their sessions, and the next segment
request fails within the edge's 15-second authorization cache window. Roles are
read from the access token (so ordinary API calls cost zero queries), which
means a *role* change takes up to 15 minutes — anything that must be instant is
enforced against Redis instead.

## Media delivery

- Segments and playlists live behind nginx `auth_request` → `/internal/edge/authz`.
- The decision is cached per `(playback cookie, stream)` for 15 seconds, so
  authorization does not collapse under a large class.
- Segments are `Cache-Control: private` — they are authorized per viewer and
  must never land in a shared proxy.
- `/internal/*` returns 404 at the edge **and** requires `INTERNAL_TOKEN`.
  Both layers matter: the token is what actually protects those routes if the
  network boundary is ever misconfigured.
- Stream ids are validated against `^[A-Za-z0-9_-]{1,64}$` before they are ever
  used as a filesystem path segment.

## Key management

- Content keys are generated per class and stored **wrapped** with AES-256-GCM
  under `CONTENT_KEY_SECRET`; the database never holds a usable key.
- Stream keys are stored twice on purpose: a SHA-256 hash for fast constant-time
  authentication, and an AES-256-GCM-wrapped copy so an instructor can re-read
  their OBS credentials without a rotation.
- `GET /v1/keys/:id` checks the token signature, that the Redis session is still
  live, **and** that the key belongs to the stream named in the token. A viewer
  authorized for one class cannot fetch another's key.
- Raw key bytes are written to `/media/keys` with mode `0600`, on a volume the
  edge does not mount, and deleted when the class ends.

### A known limitation: one IV per stream

HLS AES-128 uses CBC, which needs an initialization vector. RFC 8216 says an
absent `IV` attribute means "use the media sequence number", which would give
every segment a distinct IV.

**ffmpeg's `hlsenc` does not implement that.** Given no IV it snapshots the
sequence number once at encoder start — zero — and encrypts every segment of
every rendition under an all-zero IV. This was verified against real output
during development, not assumed.

The mitigation is to pin an IV explicitly, derived per stream via
`HMAC(content key, "hls-iv:" + streamId)` (`deriveIv` in
`apps/transcoder/src/ladder.ts`). Deriving rather than storing keeps it stable
across a mid-class transcoder restart, which matters because a changed IV would
make every already-written segment undecryptable.

**The residual weakness, stated plainly:** within a single class, all segments
share one key and one IV. An observer holding the ciphertext can therefore tell
that two segments begin with the same bytes, and how many 16-byte blocks they
share. In practice that leaks the MPEG-TS header structure, which is public
knowledge and identical for every stream in the world. It does not leak
content, and an attacker cannot choose plaintext. It is nonetheless a real
deviation from best practice; eliminating it needs periodic key rotation
(`hls_key_rotate_period` plus a multi-key key server), which is not implemented.
`scripts/smoke-verify.mjs` asserts the IV is present and non-zero so the
all-zero regression cannot come back silently.

## Abuse limits

Rate limiting is applied where abuse is actually possible rather than globally
(media and WebSocket traffic are high-volume by design): login, registration,
playback-grant requests (the only route through which a class password can be
brute-forced), key fetches, and chat posting. Slow mode and per-user limits
apply inside chat rooms. Concurrent playback sessions per user are capped
atomically with a Redis Lua script.

## What is deliberately not covered

- **DRM.** AES-128 HLS stops casual copying and network interception. It does
  not stop an authorized viewer from recording their own screen. Widevine /
  FairPlay would be the answer, and both require licensing.
- **The operator.** See above.
- **Traffic analysis.** Segment sizes are visible to a network observer and
  correlate with scene complexity.
- **Multi-tenant isolation at the process level.** Organizations are separated
  by query scoping, not by separate databases or containers.

## Before deploying publicly

1. Run `pnpm setup` to generate real secrets — the API refuses to start in
   production with placeholder values, but check anyway.
2. Terminate TLS in front of the edge and set `PUBLIC_BASE_URL` to the `https://`
   origin so `Secure` cookies are issued.
3. Do not publish MinIO, Postgres, Redis or the MediaMTX API port. Only the
   edge (`:80`/`:443`) and the ingest ports (RTMP `1935`, SRT `8890/udp`,
   WebRTC ICE `8189`) belong on the internet.
4. Set `WEBRTC_ADDITIONAL_HOSTS` to the server's public address, or WHIP/WHEP
   will advertise unroutable candidates.
5. Back up `CONTENT_KEY_SECRET` somewhere other than the server. Lose it and
   every recording becomes permanently undecryptable.
