"use client";

import type Hls from "hls.js";
import type { ErrorData, Level, ManifestParsedData } from "hls.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button, Spinner } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatBitrate } from "@/lib/format";

import { connectWhep, whepRoundTripMs, type WhepConnection } from "./whep";

export type PlayerMode = "hls" | "whep";

export type PlayerStats = {
  mode: PlayerMode;
  rendition: string | null;
  bitrateBps: number;
  bufferSeconds: number;
  latencySeconds: number | null;
  droppedFrames: number;
  resolution: string | null;
};

export type PlayerProps = {
  /** Multivariant playlist. Null while the class has not started. */
  src: string | null;
  live: boolean;
  poster?: string | null;
  whepUrl?: string | null;
  whepToken?: string | null;
  autoPlay?: boolean;
  /** Rendered over the video surface when `src` is null. */
  placeholder?: ReactNode;
  /** Fired on every ABR switch; the watch page forwards it as telemetry. */
  onQualityChange?: (stats: PlayerStats) => void;
  onFatalError?: (message: string) => void;
};

/**
 * hls.js tuned for 1-second segments.
 *
 * `liveSyncDurationCount: 2` parks the playhead two segments behind the live
 * edge: ~2.5-3s glass-to-glass once encode and ingest are added, and still
 * one full segment of slack so a single slow fetch does not stall. (Three
 * cost a whole extra second for every viewer.) `maxLiveSyncPlaybackRate` lets
 * the player catch up by playing slightly fast instead of jumping, which is
 * much less jarring than a seek mid-sentence.
 */
const HLS_CONFIG = {
  lowLatencyMode: true,
  enableWorker: true,
  backBufferLength: 30,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 12,
  maxLiveSyncPlaybackRate: 1.5,
  // Cold-start guess. Too high and the first segment stalls a slow connection;
  // too low and everyone spends the first ten seconds at 240p.
  abrEwmaDefaultEstimate: 1_200_000,
  fragLoadingMaxRetry: 6,
  manifestLoadingMaxRetry: 6,
  levelLoadingMaxRetry: 6,
} as const;

const IDLE_STATS: PlayerStats = {
  mode: "hls",
  rendition: null,
  bitrateBps: 0,
  bufferSeconds: 0,
  latencySeconds: null,
  droppedFrames: 0,
  resolution: null,
};

export function Player({
  src,
  live,
  poster,
  whepUrl,
  whepToken,
  autoPlay = true,
  placeholder,
  onQualityChange,
  onFatalError,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<WhepConnection | null>(null);

  const [mode, setMode] = useState<PlayerMode>("hls");
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [autoLevel, setAutoLevel] = useState(true);
  const [stats, setStats] = useState<PlayerStats>(IDLE_STATS);
  const [showStats, setShowStats] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [behindLive, setBehindLive] = useState(false);
  // Autoplay with sound is blocked everywhere, so an autoplaying class starts
  // muted and offers one obvious tap to turn the audio on.
  const [muted, setMuted] = useState(autoPlay);

  // Kept in a ref so the effects below do not re-run when the parent
  // re-renders with a new closure.
  const qualityCallback = useRef(onQualityChange);
  qualityCallback.current = onQualityChange;
  const fatalCallback = useRef(onFatalError);
  fatalCallback.current = onFatalError;

  const canUseWhep = Boolean(whepUrl) && live;

  // ── HLS ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "hls" || !src) return;

    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    setError(null);

    void (async () => {
      const { default: HlsCtor } = await import("hls.js");
      if (disposed) return;

      if (!HlsCtor.isSupported()) {
        // Safari on iPhone: no MSE, but a native HLS pipeline that already
        // understands AES-128 and sends our same-origin cookie by itself.
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
          if (autoPlay) void video.play().catch(() => undefined);
          return;
        }
        setError("This browser cannot play HLS video");
        return;
      }

      const hls = new HlsCtor(HLS_CONFIG);
      hlsRef.current = hls;

      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data: ManifestParsedData) => {
        setLevels(data.levels);
        if (autoPlay) void video.play().catch(() => undefined);
      });

      hls.on(HlsCtor.Events.LEVEL_SWITCHED, () => {
        setCurrentLevel(hls.currentLevel);
        const level = hls.levels[hls.currentLevel];
        if (level) {
          qualityCallback.current?.({
            mode: "hls",
            rendition: renditionName(level),
            bitrateBps: level.bitrate,
            bufferSeconds: bufferAhead(video),
            latencySeconds: liveLatency(hls, video),
            droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
            resolution: level.height ? `${level.width}x${level.height}` : null,
          });
        }
      });

      hls.on(HlsCtor.Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal) return;

        switch (data.type) {
          case HlsCtor.ErrorTypes.NETWORK_ERROR:
            // Covers the instructor's encoder briefly dropping out as well as
            // real network loss; retrying is right in both cases.
            hls.startLoad();
            break;
          case HlsCtor.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default: {
            const message =
              data.response?.code === 401 || data.response?.code === 403
                ? "Your access to this class has expired. Reload to continue."
                : "Playback failed. Try reloading the page.";
            setError(message);
            fatalCallback.current?.(message);
            hls.destroy();
          }
        }
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    })();

    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setLevels([]);
      setCurrentLevel(-1);
    };
  }, [mode, src, autoPlay]);

  // ── WHEP ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "whep" || !whepUrl) return;

    const video = videoRef.current;
    if (!video) return;

    const controller = new AbortController();
    let connection: WhepConnection | null = null;
    setError(null);
    setBuffering(true);

    void (async () => {
      try {
        connection = await connectWhep(video, {
          url: whepUrl,
          token: whepToken ?? null,
          signal: controller.signal,
          onState: (state) => {
            if (state === "connected") setBuffering(false);
            if (state === "failed") {
              // Falling back rather than erroring: HLS works on networks that
              // block UDP, which is exactly when WHEP fails.
              setError("Low-latency mode could not connect; switched back to standard.");
              setMode("hls");
            }
          },
        });
        whepRef.current = connection;
        if (autoPlay) void video.play().catch(() => undefined);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "Low-latency mode failed"));
        setMode("hls");
      }
    })();

    return () => {
      controller.abort();
      void connection?.close();
      whepRef.current = null;
      setBuffering(false);
    };
  }, [mode, whepUrl, whepToken, autoPlay]);

  // ── Stats sampling ───────────────────────────────────────────────────────

  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        const video = videoRef.current;
        if (!video) return;

        const quality = video.getVideoPlaybackQuality?.();
        const hls = hlsRef.current;
        const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;

        const latency =
          mode === "whep"
            ? await whepLatency(whepRef.current)
            : hls
              ? liveLatency(hls, video)
              : null;

        setStats({
          mode,
          rendition: level ? renditionName(level) : mode === "whep" ? "source" : null,
          bitrateBps: level?.bitrate ?? 0,
          bufferSeconds: bufferAhead(video),
          latencySeconds: latency,
          droppedFrames: quality?.droppedVideoFrames ?? 0,
          resolution:
            video.videoWidth > 0 ? `${video.videoWidth}x${video.videoHeight}` : null,
        });

        if (live && hls) {
          const drift = liveLatency(hls, video);
          setBehindLive(drift !== null && drift > 20);
        }
      })();
    }, 1000);

    return () => clearInterval(timer);
  }, [mode, live]);

  // ── Media element wiring ─────────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);

    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onPlaying);

    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onPlaying);
    };
  }, []);

  const selectLevel = useCallback((value: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    // -1 hands control back to the ABR controller. Anything else pins the
    // ladder, which viewers on metered connections ask for constantly.
    hls.currentLevel = value;
    setAutoLevel(value === -1);
    setCurrentLevel(value);
  }, []);

  const jumpToLive = useCallback(() => {
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!hls || !video) return;
    if (Number.isFinite(hls.liveSyncPosition)) {
      video.currentTime = hls.liveSyncPosition as number;
    }
    void video.play().catch(() => undefined);
    setBehindLive(false);
  }, []);

  const qualityOptions = useMemo(
    () =>
      levels
        .map((level, index) => ({ index, label: renditionName(level), bitrate: level.bitrate }))
        .sort((a, b) => b.bitrate - a.bitrate),
    [levels],
  );

  return (
    <div className="group bg-ink-950 relative aspect-video w-full overflow-hidden rounded-xl">
      <video
        ref={videoRef}
        className="size-full bg-black"
        playsInline
        controls={Boolean(src) || mode === "whep"}
        muted={muted}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        {...(poster ? { poster } : {})}
      />

      {muted && (src || mode === "whep") && (
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = false;
            setMuted(false);
            void video.play().catch(() => undefined);
          }}
          className="absolute top-3 left-3 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur"
        >
          Tap for sound
        </button>
      )}

      {!src && mode === "hls" && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center">
          {placeholder ?? (
            <p className="text-ink-300 text-sm">This class has not started yet.</p>
          )}
        </div>
      )}

      {buffering && (src || mode === "whep") && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner className="size-8 text-white/80" />
        </div>
      )}

      {error && (
        <div className="absolute inset-x-0 top-0 bg-black/80 px-4 py-2 text-center text-sm text-white">
          {error}
        </div>
      )}

      {behindLive && (
        <button
          type="button"
          onClick={jumpToLive}
          className="bg-live-500 absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-lg"
        >
          Jump to live
        </button>
      )}

      {/* Control strip. Fades in on hover/focus so it never covers the lesson. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          {canUseWhep && (
            <Button
              size="sm"
              variant={mode === "whep" ? "live" : "secondary"}
              onClick={() => setMode(mode === "whep" ? "hls" : "whep")}
              title="Sub-second WebRTC playback. Uses more bandwidth and may not work on restricted networks."
            >
              {mode === "whep" ? "Ultra-low latency: on" : "Ultra-low latency"}
            </Button>
          )}

          {mode === "hls" && qualityOptions.length > 0 && (
            <select
              aria-label="Video quality"
              value={autoLevel ? -1 : currentLevel}
              onChange={(event) => selectLevel(Number(event.target.value))}
              className="border-ink-700 rounded-lg border bg-black/70 px-2 py-1.5 text-xs text-white"
            >
              <option value={-1}>
                Auto{autoLevel && currentLevel >= 0
                  ? ` (${qualityOptions.find((o) => o.index === currentLevel)?.label ?? ""})`
                  : ""}
              </option>
              {qualityOptions.map((option) => (
                <option key={option.index} value={option.index}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowStats((value) => !value)}
            aria-pressed={showStats}
          >
            Stats
          </Button>
        </div>
      </div>

      {showStats && <StatsOverlay stats={stats} />}
    </div>
  );
}

function StatsOverlay({ stats }: { stats: PlayerStats }) {
  const rows: Array<[string, string]> = [
    ["Mode", stats.mode === "whep" ? "WebRTC (WHEP)" : "HLS"],
    ["Rendition", stats.rendition ?? "—"],
    ["Resolution", stats.resolution ?? "—"],
    ["Bitrate", stats.bitrateBps ? formatBitrate(stats.bitrateBps) : "—"],
    ["Buffer", `${stats.bufferSeconds.toFixed(1)}s`],
    [
      "Latency",
      stats.latencySeconds === null ? "—" : `${stats.latencySeconds.toFixed(1)}s`,
    ],
    ["Dropped frames", String(stats.droppedFrames)],
  ];

  return (
    <dl className="absolute top-14 left-3 w-52 rounded-lg bg-black/80 p-3 font-mono text-[11px] text-white/90">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 py-0.5">
          <dt className="text-white/50">{label}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function renditionName(level: Level): string {
  return level.height ? `${level.height}p` : formatBitrate(level.bitrate);
}

function bufferAhead(video: HTMLVideoElement): number {
  const buffered = video.buffered;
  for (let i = 0; i < buffered.length; i += 1) {
    if (video.currentTime >= buffered.start(i) && video.currentTime <= buffered.end(i)) {
      return buffered.end(i) - video.currentTime;
    }
  }
  return 0;
}

function liveLatency(hls: Hls, video: HTMLVideoElement): number | null {
  // hls.js exposes `latency` only when it has a program-date-time reference;
  // the distance to the live sync position is the reliable fallback.
  if (Number.isFinite(hls.latency) && hls.latency > 0) return hls.latency;
  const sync = hls.liveSyncPosition;
  if (sync === null || !Number.isFinite(sync)) return null;
  return Math.max(0, sync - video.currentTime);
}

async function whepLatency(connection: WhepConnection | null): Promise<number | null> {
  if (!connection) return null;
  const rtt = await whepRoundTripMs(connection.pc);
  // Half the round trip is the one-way network delay; encode and jitter-buffer
  // delay are on top of that and not observable from here, so this is a floor.
  return rtt === null ? null : rtt / 2000;
}

// (no re-exports: screens import formatters from @/lib/format directly)
