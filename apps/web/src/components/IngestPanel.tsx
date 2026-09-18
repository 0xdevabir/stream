"use client";

import { useState } from "react";

import { CopyField } from "@/components/ui";

export type IngestCredentials = {
  rtmp: { url: string; streamKey: string };
  srt: { url: string };
};

/**
 * OBS / hardware-encoder ingest credentials for a live input.
 * Stream key is masked by default — a leaked key lets anyone publish.
 */
export function IngestPanel({
  ingest,
}: {
  ingest: IngestCredentials;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Publish with OBS or a hardware encoder</h3>
        <p className="text-ink-500 mt-1 text-xs">
          In OBS: Settings → Stream → Service &ldquo;Custom&rdquo;, then paste the
          server and stream key below. Set keyframe interval to 1 second for the
          lowest latency.
        </p>
      </div>

      <CopyField label="RTMP server" value={ingest.rtmp.url} />

      <div>
        <CopyField
          label="Stream key"
          value={ingest.rtmp.streamKey}
          masked={!revealed}
        />
        <div className="mt-1.5 flex gap-3">
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            className="text-ink-500 hover:text-ink-100 text-xs"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
        </div>
      </div>

      <details className="text-ink-500 text-xs">
        <summary className="hover:text-ink-300 cursor-pointer">
          SRT (lower latency over lossy networks)
        </summary>
        <div className="pt-3">
          <CopyField label="SRT URL" value={ingest.srt.url} masked={!revealed} />
        </div>
      </details>
    </div>
  );
}
