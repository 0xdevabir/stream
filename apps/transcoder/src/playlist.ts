/**
 * Minimal HLS media-playlist parsing and generation.
 *
 * The recording pipeline turns a live class into a replay *without
 * re-encoding*: the segments ffmpeg already wrote are exactly the segments the
 * replay serves. All that has to happen is turning the rolling live playlist
 * (which only ever lists the last few seconds) into a complete VOD playlist.
 *
 * The one thing that must not break: AES-128 IVs. With no IV pinned in the key
 * info file, ffmpeg derives each segment's IV from its *absolute* media
 * sequence number. So the VOD playlist has to preserve those numbers -- if it
 * renumbered from zero, every segment would fail to decrypt.
 */

export interface PlaylistSegment {
  /** Absolute media sequence number. Also the AES-128 IV. */
  sequence: number;
  duration: number;
  uri: string;
  /** EXT-X-KEY in force for this segment, if any. */
  key: string | null;
  /** EXT-X-PROGRAM-DATE-TIME, when ffmpeg emitted one. */
  programDateTime: string | null;
  /** True when a discontinuity precedes this segment. */
  discontinuity: boolean;
}

export interface ParsedPlaylist {
  mediaSequence: number;
  targetDuration: number;
  segments: PlaylistSegment[];
  ended: boolean;
}

export function parseMediaPlaylist(text: string): ParsedPlaylist {
  const lines = text.split("\n").map((line) => line.trim());

  let mediaSequence = 0;
  let targetDuration = 1;
  let ended = false;

  let pendingDuration: number | null = null;
  let pendingDateTime: string | null = null;
  let pendingDiscontinuity = false;
  let currentKey: string | null = null;

  const segments: PlaylistSegment[] = [];
  let sequence = 0;
  let sawSequenceTag = false;

  for (const line of lines) {
    if (line.length === 0) continue;

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = Number.parseInt(line.slice(22), 10) || 0;
      sequence = mediaSequence;
      sawSequenceTag = true;
      continue;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = Number.parseInt(line.slice(22), 10) || 1;
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      currentKey = line;
      continue;
    }
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      pendingDateTime = line.slice(25);
      continue;
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      pendingDiscontinuity = true;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pendingDuration = Number.parseFloat(line.slice(8).split(",")[0] ?? "0");
      continue;
    }
    if (line === "#EXT-X-ENDLIST") {
      ended = true;
      continue;
    }
    if (line.startsWith("#")) continue;

    // A bare line following #EXTINF is a segment URI.
    if (pendingDuration !== null) {
      if (!sawSequenceTag && segments.length === 0) sequence = mediaSequence;

      segments.push({
        sequence,
        duration: pendingDuration,
        uri: line,
        key: currentKey,
        programDateTime: pendingDateTime,
        discontinuity: pendingDiscontinuity,
      });

      sequence += 1;
      pendingDuration = null;
      pendingDateTime = null;
      pendingDiscontinuity = false;
    }
  }

  return { mediaSequence, targetDuration, segments, ended };
}

/**
 * Renders a complete VOD playlist from accumulated segments.
 *
 * `EXT-X-MEDIA-SEQUENCE` is set to the first retained segment's absolute
 * number rather than zero, which is what keeps AES-128 decryption working.
 */
export function buildVodPlaylist(
  segments: PlaylistSegment[],
  options: { ended: boolean },
): string {
  if (segments.length === 0) {
    return "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n";
  }

  const targetDuration = Math.max(
    1,
    Math.ceil(Math.max(...segments.map((segment) => segment.duration))),
  );

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${segments[0]!.sequence}`,
  ];

  let currentKey: string | null = null;

  for (const segment of segments) {
    // Emit EXT-X-KEY only when it changes; it applies to all following
    // segments until superseded.
    if (segment.key && segment.key !== currentKey) {
      lines.push(segment.key);
      currentKey = segment.key;
    }
    if (segment.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    if (segment.programDateTime) {
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segment.programDateTime}`);
    }
    lines.push(`#EXTINF:${segment.duration.toFixed(6)},`);
    lines.push(segment.uri);
  }

  if (options.ended) lines.push("#EXT-X-ENDLIST");

  return `${lines.join("\n")}\n`;
}

/**
 * Rewrites the key URI in a playlist so ffmpeg can read the key straight off
 * disk. Used only to remux the downloadable MP4 locally, where going back
 * through the authenticated HTTP endpoint would be absurd.
 */
export function rewriteKeyUri(playlist: string, keyUri: string): string {
  return playlist.replace(
    /^#EXT-X-KEY:.*$/gm,
    (line) => line.replace(/URI="[^"]*"/, `URI="${keyUri}"`),
  );
}

export function totalDuration(segments: PlaylistSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.duration, 0);
}
