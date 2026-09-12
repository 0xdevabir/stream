# Architecture

## The economic idea

Hosted video is billed per minute ingested and per minute delivered. That
second number is the one that grows with your audience, and it is the one this
design removes.

Every viewer here is served **plain HTTP files by nginx**. A segment is a file
on disk; serving it to the thousandth viewer costs the same as serving it to
the first, minus nothing but bandwidth. Transcoding happens **once per class**,
no matter how many people watch. Recording is close to free because the replay
*is* the live stream's segments — nothing is re-encoded.

The cost curve is therefore: one CPU-bound encode per concurrent class, plus
bandwidth. Nothing scales with viewer count except bytes on the wire.

## The shape

```
Instructor
  ├─ Browser "Go Live"  ──WHIP/WebRTC──┐
  └─ OBS / SRT / RTMP ──stream key─────┤
                                       ▼
                              ┌─────────────────┐
                              │    MediaMTX     │──auth hook──▶ API
                              │  ingest + WHEP  │
                              └────────┬────────┘
                    WHEP (sub-second)  │  RTSP pull (in-network)
                         ▲             ▼
                         │      ┌──────────────┐
                    few viewers │  transcoder  │ 1 ffmpeg proc, aligned GOPs
                                │  (Node sup.) │ 1080p/720p/480p/360p
                                └──────┬───────┘
                                       │ AES-128 HLS, 1s segments
                                       ▼
                              ┌─────────────────┐
                              │  nginx edge     │ auth_request ─▶ API /internal/edge/authz
                              │  (cache, range) │ key URI ──────▶ API /v1/keys/:id
                              └────────┬────────┘
                                       ▼
                            hls.js viewers (thousands)

  stream ends ──▶ recorder ──▶ VOD playlists (no re-encode) + MP4 remux
                           ──▶ S3/MinIO ──▶ replay library
```

## Why each piece

**MediaMTX** is one binary that already speaks RTMP, SRT, RTSP *and*
WHIP/WHEP, with an HTTP authorization hook. Using it removes an entire
category of custom ingest code. Its image is `scratch`-based (no shell), which
is why the transcoder polls its API rather than relying on `runOn*` hooks.

**One ffmpeg process** emits every rendition from a single decode, with
`-force_key_frames` on a shared expression and `-sc_threshold 0` so GOPs align
across the ladder. Misaligned GOPs are the classic cause of a stall on every
quality switch — and they cost nothing to get right if you do it in one
process. Four separate ffmpeg instances would decode the source four times and
drift apart.

**The transcoder reconciles rather than reacts.** It polls MediaMTX's API for
which paths have a publisher and converges on that state. A missed webhook
cannot leave a class permanently stuck, which is the failure mode that matters
when the alternative is a lecturer standing in front of a room.

**nginx `auth_request` with `proxy_cache`** authorizes media. The decision is
cached on `"$cookie_pt|$media_scope"` for 15 seconds, so a 1000-viewer class
costs the API a few requests per second instead of one per segment per viewer,
while segments themselves stay ordinary cacheable files.

**A single origin** serves the app, the API, the segments, the key endpoint and
the WebSocket. That is what lets one `HttpOnly` cookie authorize all of them —
no CORS, no tokens in query strings, and iOS Safari's *native* HLS player
(which gives no hook to attach a header) works unmodified.

## The VOD path

When the publisher disconnects, the recorder:

1. reads each rendition's accumulated `vod.m3u8` sidecar,
2. closes it (`EXT-X-PLAYLIST-TYPE:VOD`, `EXT-X-ENDLIST`),
3. uploads the **existing** segments plus the new playlists to object storage,
4. remuxes a progressive MP4 with `-c copy`,
5. writes the `Recording` row and flips the class to `ENDED`.

No frame is encoded twice. A class that cost one encode to broadcast costs
zero to keep.

## Latency

| Path | Glass-to-glass | Scales to |
|------|----------------|-----------|
| HLS, 1s segments | ~3 seconds | thousands (bandwidth only) |
| WHEP (WebRTC) | sub-second | tens (a PeerConnection each) |

True LL-HLS partial segments (`EXT-X-PART`) are not available: ffmpeg's
`hlsenc` does not implement them. Rather than pretend, the HLS path is tuned
as far as 1-second segments allow (`liveSyncDurationCount: 3`, catch-up via
`maxLiveSyncPlaybackRate` instead of seeking), and classes that genuinely need
real-time interaction opt into `ULTRA` mode, which additionally offers WHEP
straight from MediaMTX.

That trade bought something real: because we encode the ladder ourselves rather
than letting MediaMTX serve HLS, the segments can be **AES-128 encrypted**,
which MediaMTX's own HLS output cannot do.

## Where the interesting code is

| Concern | File |
|---|---|
| ffmpeg arguments, GOP alignment, encryption | `apps/transcoder/src/ladder.ts` |
| Live → VOD playlist rewriting | `apps/transcoder/src/playlist.ts` |
| The single access-control resolver | `apps/api/src/services/access.ts` |
| MediaMTX + nginx hooks | `apps/api/src/routes/internal.ts` |
| AES key delivery | `apps/api/src/routes/keys.ts` |
| Player (hls.js + WHEP) | `apps/web/src/components/player/Player.tsx` |
| Edge routing and caching | `infra/nginx/stream.conf.template` |
| Canonical media layout | `packages/shared/src/paths.ts` |
