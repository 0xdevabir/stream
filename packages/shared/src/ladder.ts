/**
 * The adaptive bitrate ladder.
 *
 * Every rendition here is produced by a SINGLE ffmpeg process so that all
 * variants share identical GOP boundaries -- that alignment is what lets a
 * player switch quality mid-stream without a visible stall. See
 * `apps/transcoder/src/ladder.ts` for the encoder invocation.
 *
 * Bitrates are tuned for talking-head / screen-share teaching content, which
 * is far less demanding than sports or gaming footage.
 */

export const RENDITION_NAMES = ["1080p", "720p", "480p", "360p", "240p"] as const;

export type RenditionName = (typeof RENDITION_NAMES)[number];

export interface Rendition {
  name: RenditionName;
  /** Encoded height in pixels. Width is derived to preserve source aspect. */
  height: number;
  /** Nominal width for a 16:9 source, used for playlist RESOLUTION hints. */
  width: number;
  videoKbps: number;
  /** VBV ceiling. Kept close to the nominal rate to avoid buffer spikes. */
  maxrateKbps: number;
  bufsizeKbps: number;
  audioKbps: number;
  /** H.264 profile. `baseline` keeps the bottom rung playable on old devices. */
  profile: "high" | "main" | "baseline";
  level: string;
}

export const RENDITIONS: Record<RenditionName, Rendition> = {
  "1080p": {
    name: "1080p",
    height: 1080,
    width: 1920,
    videoKbps: 4500,
    maxrateKbps: 4950,
    bufsizeKbps: 9000,
    audioKbps: 128,
    profile: "high",
    level: "4.1",
  },
  "720p": {
    name: "720p",
    height: 720,
    width: 1280,
    videoKbps: 2500,
    maxrateKbps: 2750,
    bufsizeKbps: 5000,
    audioKbps: 128,
    profile: "main",
    level: "3.1",
  },
  "480p": {
    name: "480p",
    height: 480,
    width: 854,
    videoKbps: 1200,
    maxrateKbps: 1320,
    bufsizeKbps: 2400,
    audioKbps: 96,
    profile: "main",
    level: "3.0",
  },
  "360p": {
    name: "360p",
    height: 360,
    width: 640,
    videoKbps: 700,
    maxrateKbps: 770,
    bufsizeKbps: 1400,
    audioKbps: 96,
    profile: "baseline",
    level: "3.0",
  },
  "240p": {
    name: "240p",
    height: 240,
    width: 426,
    videoKbps: 350,
    maxrateKbps: 385,
    bufsizeKbps: 700,
    audioKbps: 64,
    profile: "baseline",
    level: "3.0",
  },
};

export function isRenditionName(value: string): value is RenditionName {
  return (RENDITION_NAMES as readonly string[]).includes(value);
}

/**
 * Parse a `LADDER` env value ("1080p,720p,480p,360p") into renditions ordered
 * highest-first. Unknown names are rejected loudly rather than silently
 * dropped -- a typo here would otherwise ship a stream with a missing rung.
 */
export function parseLadder(spec: string): Rendition[] {
  const names = spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (names.length === 0) {
    throw new Error("LADDER is empty; expected e.g. '720p,480p,360p'");
  }

  const seen = new Set<RenditionName>();
  const out: Rendition[] = [];

  for (const name of names) {
    if (!isRenditionName(name)) {
      throw new Error(
        `Unknown rendition '${name}' in LADDER. Valid: ${RENDITION_NAMES.join(", ")}`,
      );
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(RENDITIONS[name]);
  }

  return out.sort((a, b) => b.height - a.height);
}

/** Rough CPU guidance surfaced in the dashboard and docs. */
export function ladderCostHint(renditions: Rendition[]): {
  totalEgressKbps: number;
  approxCores: number;
} {
  const totalEgressKbps = renditions.reduce(
    (sum, r) => sum + r.videoKbps + r.audioKbps,
    0,
  );
  // x264 veryfast on a modern server core handles roughly 1080p30 in realtime;
  // lower rungs are cheap relative to the top one.
  const approxCores = renditions.reduce(
    (sum, r) => sum + Math.max(0.25, r.height / 1080),
    0,
  );
  return { totalEgressKbps, approxCores: Math.ceil(approxCores) };
}
