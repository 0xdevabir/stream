"use client";

import type { RefObject } from "react";

import { classNames, formatBitrate, formatClock } from "@/lib/format";

import type { BroadcastPhase } from "./useBroadcast";

const PHASE_LABEL: Record<Exclude<BroadcastPhase, "idle">, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

/**
 * What the instructor is about to send, or is sending.
 *
 * The overlay deliberately distinguishes "reconnecting" from "off air": a
 * dropped WebRTC connection is routine and recovers by itself, and a lecturer
 * mid-sentence needs to see that difference at a glance rather than assume
 * the class has died and start over.
 */
export function PreviewStage({
  videoRef,
  previewing,
  phase,
  elapsed,
  bitrate,
  reconnects,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  previewing: boolean;
  phase: BroadcastPhase;
  elapsed: number;
  bitrate: number | null;
  reconnects: number;
}) {
  const onAir = phase !== "idle";

  return (
    <div className="border-ink-800 bg-ink-950 relative aspect-video overflow-hidden rounded-xl border">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // Monitoring your own microphone through the speakers is an instant
        // feedback loop; the preview is always silent.
        muted
        className="size-full bg-black object-contain"
      />

      {!previewing && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <div className="bg-ink-900 text-ink-500 mx-auto mb-3 grid size-12 place-items-center rounded-full text-xl">
              ◉
            </div>
            <p className="text-ink-300 text-sm">No preview yet</p>
            <p className="text-ink-500 mt-1 text-xs">
              Choose a source below, then start the preview.
            </p>
          </div>
        </div>
      )}

      {onAir && (
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
          <span
            className={classNames(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur",
              phase === "live" ? "bg-live-500 text-white" : "bg-black/75 text-amber-400",
            )}
          >
            <span
              className={classNames(
                "size-2 rounded-full",
                phase === "live" ? "live-dot bg-white" : "animate-pulse bg-amber-400",
              )}
            />
            {PHASE_LABEL[phase as Exclude<BroadcastPhase, "idle">]}
          </span>

          <span className="rounded-full bg-black/75 px-3 py-1.5 text-xs tabular-nums backdrop-blur">
            {formatClock(elapsed)}
          </span>

          {bitrate !== null && phase === "live" && (
            <span className="text-ink-300 rounded-full bg-black/75 px-3 py-1.5 text-xs backdrop-blur">
              {formatBitrate(bitrate)} up
            </span>
          )}

          {reconnects > 0 && (
            <span
              className="text-ink-300 rounded-full bg-black/75 px-3 py-1.5 text-xs backdrop-blur"
              title="The connection dropped and was re-established automatically. The class kept running."
            >
              {reconnects} reconnect{reconnects === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {phase === "reconnecting" && (
        <div className="absolute inset-x-0 bottom-0 bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-300 backdrop-blur">
          Connection dropped — reconnecting automatically. Your class is still
          open and students stay in the room.
        </div>
      )}
    </div>
  );
}
