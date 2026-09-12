# Running it

## Locally

```bash
pnpm setup          # generate secrets, install, build shared, generate Prisma client
pnpm up             # docker compose up -d --build
pnpm db:seed        # an org, an instructor, three students, two classes
```

Then open <http://localhost:8080> and sign in as
`instructor@example.com` / `changeme-please`.

Migrations are applied by the API container on boot, so there is no separate
step and no window where a new binary serves against an old schema. Set
`RUN_MIGRATIONS=0` if you run more than one API replica and migrate out of
band.

### Prove the pipeline works

```bash
node scripts/smoke-stream.mjs --seconds 120   # terminal 1: synthetic lecture over RTMP
node scripts/smoke-verify.mjs                 # terminal 2: assert the whole chain
```

`smoke-stream` publishes a test pattern with a burned-in clock, using ffmpeg
inside the transcoder container — nothing to install, and the same ffmpeg build
production uses. Put the browser next to the terminal and compare the two
clocks to read glass-to-glass latency directly.

`smoke-verify` asserts the properties that break silently: the ladder is
advertised, segments are AES-128 with a non-zero IV, and playlists, segments
and keys are all refused without a playback cookie and served with one.

## On one server

The whole thing is designed to run on a single box. A rough guide:

| Concurrent classes | vCPU | RAM | Notes |
|---|---|---|---|
| 1 | 4 | 8 GB | 720p ladder, `x264 veryfast` |
| 3 | 8 | 16 GB | |
| 8+ | 16+ | 32 GB | consider a GPU encoder (`VIDEO_ENCODER=h264_nvenc`) |

Viewers cost bandwidth, not CPU. A 1000-viewer class at an average 1.5 Mbps is
~1.5 Gbps of egress — that, not the server, is your real constraint, and it is
also exactly the line item a hosted platform would be marking up.

Storage: roughly `(sum of ladder bitrates) × duration`. The default ladder is
about 5 Mbps total, so ~2.2 GB per hour of class, held on the `media` volume
during the class and in object storage afterwards.

### Steps

1. **Point DNS** at the box and terminate TLS in front of the edge (Caddy,
   nginx, or a load balancer). Set `PUBLIC_BASE_URL=https://your.domain`.
2. **Generate secrets** with `pnpm setup`, or set them yourself. The API refuses
   to start in production with placeholder or all-zero values.
3. **Swap object storage** to something durable. Only these change:
   ```bash
   S3_ENDPOINT=https://s3.us-west-001.backblazeb2.com
   S3_REGION=us-west-001
   S3_BUCKET=your-recordings
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_FORCE_PATH_STYLE=false
   ```
   Then drop the `minio` and `minio-init` services. Backblaze B2 and Hetzner
   Object Storage are both S3-compatible and roughly an order of magnitude
   cheaper than the hyperscalers for this workload.
4. **Set `WEBRTC_ADDITIONAL_HOSTS`** to the server's public IP or hostname.
   Browsers cannot reach Docker-internal addresses, so without this the ICE
   candidates MediaMTX advertises are unroutable and WHIP/WHEP silently fail.
5. **Open only what is needed**: 443 (edge), 1935/tcp (RTMP), 8890/udp (SRT),
   8189/tcp+udp (WebRTC ICE). Postgres, Redis, MinIO and the MediaMTX API port
   must not be reachable from the internet.
6. **Back up** Postgres and `CONTENT_KEY_SECRET`. Losing the secret makes every
   recording permanently undecryptable — it is not recoverable from a database
   backup, because that is the point of it.

## Tuning

| Variable | Meaning | Default |
|---|---|---|
| `LADDER` | Renditions to produce | `1080p,720p,480p,360p` |
| `HLS_SEGMENT_SECONDS` | Segment length; the main latency lever | `1` |
| `HLS_LIST_SIZE` | Segments in the live window | `8` |
| `VIDEO_ENCODER` | `libx264`, `h264_nvenc`, `h264_videotoolbox` | `libx264` |
| `X264_PRESET` | Speed/quality trade | `veryfast` |
| `PLAYBACK_TOKEN_TTL` | Playback cookie lifetime, seconds | `3600` |
| `MAX_CONCURRENT_SESSIONS_PER_USER` | Credential-sharing cap | `3` |

The ladder never upscales: a 720p source produces 720p/480p/360p and simply
omits 1080p. That is why the smoke test's master playlist lists three variants
rather than four.

Shortening `HLS_SEGMENT_SECONDS` below 1 raises request rate and overhead
faster than it lowers latency. If you need better than ~3 seconds, switch the
class to `ULTRA` and use the WebRTC path instead.

## Operating

```bash
pnpm ps                    # what is running
pnpm logs                  # follow everything
pnpm db:studio             # browse the database
docker compose -f infra/docker-compose.yml logs -f transcoder
```

**A class is stuck at LIVE with nothing playing.** The transcoder reconciles
against MediaMTX every few seconds, so this resolves itself; if it does not,
the transcoder is down. `POST /v1/streams/:id/end` converges the row when no
publisher is connected.

**A class ended but no recording appeared.** Check the transcoder log for
`uploading recording`. The most common cause is object storage credentials —
the class still ends correctly, the upload is what failed.

**Viewers see 401 mid-class.** The playback cookie expired and renewal failed.
The player renews at 80% of the token's life; if `PLAYBACK_TOKEN_TTL` is very
short relative to class length, raise it.

**WHEP will not connect.** Almost always `WEBRTC_ADDITIONAL_HOSTS`, or UDP 8189
blocked. The player falls back to HLS on its own, which is the right behaviour
on a restricted network.
