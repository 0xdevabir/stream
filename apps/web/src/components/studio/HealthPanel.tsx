"use client";

import { Stat } from "@/components/ui";
import { formatBitrate, formatClock, formatCount } from "@/lib/format";

import type { BroadcastPhase } from "./useBroadcast";

/**
 * The "is this actually working?" readout.
 *
 * Upload bitrate is the single most diagnostic number an instructor has: if it
 * is near zero the picture is not leaving the machine, whatever the preview
 * shows.
 */
export function HealthPanel({
  phase,
  elapsed,
  bitrate,
  reconnects,
  viewers,
  renditions,
}: {
  phase: BroadcastPhase;
  elapsed: number;
  bitrate: number | null;
  reconnects: number;
  viewers: number;
  renditions: string[];
}) {
  const live = phase === "live";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Status"
          value={
            phase === "idle"
              ? "Off air"
              : phase === "live"
                ? "On air"
                : phase === "connecting"
                  ? "Connecting"
                  : "Reconnecting"
          }
          tone={live ? "good" : phase === "idle" ? "default" : "warn"}
        />
        <Stat label="Uptime" value={phase === "idle" ? "—" : formatClock(elapsed)} />
        <Stat
          label="Upload"
          value={live && bitrate !== null ? formatBitrate(bitrate) : "—"}
          tone={live && bitrate !== null && bitrate < 200_000 ? "warn" : "default"}
        />
        <Stat label="Watching" value={formatCount(viewers)} />
      </div>

      <div className="border-ink-800 flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">
          Delivering
        </span>
        {renditions.map((rendition) => (
          <span
            key={rendition}
            className="bg-ink-850 text-ink-300 rounded-full px-2 py-0.5 text-[11px]"
          >
            {rendition}
          </span>
        ))}
        {reconnects > 0 && (
          <span className="text-ink-500 ml-auto text-xs">
            {reconnects} automatic reconnect{reconnects === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
