/**
 * Canonical media layout.
 *
 * Four processes have to agree byte-for-byte on where segments live: the
 * transcoder writes them, nginx serves them, the recording worker uploads
 * them, and the player requests them. Every one of those paths is derived
 * here so a change stays in one place.
 *
 * On-disk (shared `MEDIA_ROOT` volume):
 *   /media/live/<streamId>/master.m3u8
 *   /media/live/<streamId>/<rendition>/index.m3u8   <- rolling live window
 *   /media/live/<streamId>/<rendition>/vod.m3u8     <- grown by the recorder
 *   /media/live/<streamId>/<rendition>/seg_000123.ts
 *   /media/keys/<streamId>.key                      <- never leaves the host
 *
 * Over HTTP (single nginx front door):
 *   /hls/<streamId>/master.m3u8
 *   /hls/<streamId>/<rendition>/index.m3u8
 *   /v1/keys/<keyId>
 *   /vod/<recordingId>/master.m3u8
 */

/** Stream ids are used as filesystem path segments -- keep them inert. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function assertSafeId(id: string, label = "id"): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(id)}`);
  }
  return id;
}

// ── On-disk ────────────────────────────────────────────────────────────────

export function liveDir(mediaRoot: string, streamId: string): string {
  return `${mediaRoot}/live/${assertSafeId(streamId, "streamId")}`;
}

export function liveRenditionDir(
  mediaRoot: string,
  streamId: string,
  rendition: string,
): string {
  return `${liveDir(mediaRoot, streamId)}/${assertSafeId(rendition, "rendition")}`;
}

export function liveMasterPath(mediaRoot: string, streamId: string): string {
  return `${liveDir(mediaRoot, streamId)}/master.m3u8`;
}

export function liveVariantPlaylistPath(
  mediaRoot: string,
  streamId: string,
  rendition: string,
): string {
  return `${liveRenditionDir(mediaRoot, streamId, rendition)}/index.m3u8`;
}

/**
 * The growing VOD playlist. ffmpeg's rolling live playlist only ever lists the
 * last few segments; the recorder appends every segment it sees to this
 * sidecar so the replay can be built with zero re-encoding.
 */
export function vodVariantPlaylistPath(
  mediaRoot: string,
  streamId: string,
  rendition: string,
): string {
  return `${liveRenditionDir(mediaRoot, streamId, rendition)}/vod.m3u8`;
}

export function vodMasterPath(mediaRoot: string, streamId: string): string {
  return `${liveDir(mediaRoot, streamId)}/vod-master.m3u8`;
}

export function keyFilePath(mediaRoot: string, streamId: string): string {
  return `${mediaRoot}/keys/${assertSafeId(streamId, "streamId")}.key`;
}

export function keyInfoFilePath(mediaRoot: string, streamId: string): string {
  return `${mediaRoot}/keys/${assertSafeId(streamId, "streamId")}.keyinfo`;
}

export function recordingWorkDir(mediaRoot: string, streamId: string): string {
  return `${mediaRoot}/work/${assertSafeId(streamId, "streamId")}`;
}

// ── HTTP ───────────────────────────────────────────────────────────────────

export function liveMasterUrl(streamId: string): string {
  return `/hls/${assertSafeId(streamId, "streamId")}/master.m3u8`;
}

export function keyUrl(keyId: string): string {
  return `/v1/keys/${assertSafeId(keyId, "keyId")}`;
}

export function vodMasterUrl(recordingId: string): string {
  return `/vod/${assertSafeId(recordingId, "recordingId")}/master.m3u8`;
}

/**
 * WHIP/WHEP go through the edge's `/webrtc/` prefix, which strips it and
 * forwards to MediaMTX. The trailing path segment is MediaMTX's own
 * convention: `<path>/whip` to publish, `<path>/whep` to play.
 */
export function whepUrl(streamId: string): string {
  return `/webrtc/${mediamtxPath(streamId)}/whep`;
}

export function whipUrl(streamId: string): string {
  return `/webrtc/${mediamtxPath(streamId)}/whip`;
}

// ── Object storage ─────────────────────────────────────────────────────────

export function vodObjectPrefix(recordingId: string): string {
  return `vod/${assertSafeId(recordingId, "recordingId")}`;
}

export function vodObjectKey(recordingId: string, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  if (clean.includes("..")) {
    throw new Error(`Unsafe object path: ${relativePath}`);
  }
  return `${vodObjectPrefix(recordingId)}/${clean}`;
}

// ── MediaMTX ───────────────────────────────────────────────────────────────

/** MediaMTX path name for a stream's ingest. Mirrors `live/<streamId>`. */
export function mediamtxPath(streamId: string): string {
  return `live/${assertSafeId(streamId, "streamId")}`;
}

/** Extract the stream id from a MediaMTX path, or null if it isn't ours. */
export function streamIdFromMediamtxPath(path: string): string | null {
  const match = /^live\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  return match?.[1] ?? null;
}
