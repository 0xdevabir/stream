"use client";

import { CopyField } from "@/components/ui";

export type IngestCredentials = {
  rtmp: { url: string; streamKey: string };
  srt: { url: string };
  whip?: { url: string };
};

export function IngestPanel({
  ingest,
}: {
  ingest: IngestCredentials;
}) {
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

      <CopyField
        label="Stream key"
        value={ingest.rtmp.streamKey}
        masked
        revealable
      />

      {ingest.whip?.url ? (
        <CopyField label="WHIP URL" value={ingest.whip.url} />
      ) : null}

      <details className="text-ink-500 text-xs">
        <summary className="hover:text-ink-300 cursor-pointer">
          SRT (lower latency over lossy networks)
        </summary>
        <div className="pt-3">
          <CopyField label="SRT URL" value={ingest.srt.url} masked revealable />
        </div>
      </details>
    </div>
  );
}
