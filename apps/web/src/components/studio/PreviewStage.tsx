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
    <div className="theme-dark bg-ink-950 relative aspect-video overflow-hidden rounded-[22px]">
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
            <div className="bg-ink-850 text-ink-500 mx-auto mb-3 grid size-14 place-items-center rounded-full">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
                <rect x="2.75" y="5.25" width="13.5" height="13.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="m17.5 10 3.4-2.1a.7.7 0 0 1 1.1.6v7a.7.7 0 0 1-1.1.6L17.5 14z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-ink-300 text-[15px] font-semibold">No preview</p>
          </div>
        </div>
      )}

      {onAir && (
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
          <span
            className={classNames(
              "animate-pop-in inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold backdrop-blur-xl",
              phase === "live" ? "bg-live-500 text-white" : "bg-black/40 text-warn-500",
            )}
          >
            <span
              className={classNames(
                "size-2 rounded-full",
                phase === "live" ? "live-dot bg-white" : "animate-pulse bg-warn-500",
              )}
            />
            {PHASE_LABEL[phase as Exclude<BroadcastPhase, "idle">]}
          </span>

          <span className="font-rounded rounded-full bg-black/40 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-xl backdrop-saturate-150 tabular-nums">
            {formatClock(elapsed)}
          </span>

          {bitrate !== null && phase === "live" && (
            <span className="rounded-full bg-black/40 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-xl backdrop-saturate-150">
              {formatBitrate(bitrate)} up
            </span>
          )}

          {reconnects > 0 && (
            <span
              className="rounded-full bg-black/40 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-xl backdrop-saturate-150"
              title="The connection dropped and was re-established automatically. The class kept running."
            >
              {reconnects} reconnect{reconnects === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {phase === "reconnecting" && (
        <div className="animate-fade-in absolute inset-x-3 bottom-3 rounded-2xl bg-black/50 px-4 py-2.5 text-center text-[13px] text-white backdrop-blur-xl">
          Reconnecting… students stay in the room.
        </div>
      )}
    </div>
  );
}
