"use client";

import { useState } from "react";

import { Button, CopyField } from "@/components/ui";

export type IngestCredentials = {
  rtmp: { url: string; streamKey: string };
  srt: { url: string };
};

/**
 * OBS / hardware-encoder setup.
 *
 * The stream key is masked by default and revealed on request: instructors
 * open this panel while screen-sharing far more often than they would like to
 * admit, and a leaked key lets anyone publish into their class.
 */
export function IngestPanel({
  ingest,
  onRotate,
  rotating,
}: {
  ingest: IngestCredentials;
  onRotate?: () => void;
  rotating?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-ink-500 text-xs">
        OBS → Settings → Stream → Custom. Keyframe interval 1s.
      </p>

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
          {onRotate && (
            <button
              type="button"
              onClick={onRotate}
              disabled={rotating}
              className="text-ink-500 hover:text-live-500 text-xs disabled:opacity-50"
            >
              {rotating ? "Rotating…" : "Rotate key"}
            </button>
          )}
        </div>
      </div>

      <details className="text-ink-500 text-xs">
        <summary className="hover:text-ink-300 cursor-pointer">
          SRT
        </summary>
        <div className="pt-3">
          <CopyField label="SRT URL" value={ingest.srt.url} masked={!revealed} />
        </div>
      </details>
    </div>
  );
}

export function ShareLinkPanel({
  slug,
  shareToken,
  accessMode,
}: {
  slug: string;
  shareToken: string | null;
  accessMode: string;
}) {
  // A LINK-mode class is watched through a tokenised URL; every other mode
  // resolves access from the viewer's session, so the plain link is correct.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url =
    accessMode === "LINK" && shareToken
      ? `${origin}/watch/${slug}?t=${shareToken}`
      : `${origin}/watch/${slug}`;

  return (
    <div className="space-y-2">
      <CopyField label="Student link" value={url} />
      {accessMode === "LINK" && (
        <p className="text-ink-500 text-xs">Anyone with this link can watch.</p>
      )}
    </div>
  );
}

export function GoLiveHint({ onOpenStudio }: { onOpenStudio: () => void }) {
  return (
    <div className="border-brand-500/30 bg-brand-500/5 flex flex-wrap items-center gap-3 rounded-2xl border p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Go live from your browser</p>
      </div>
      <Button onClick={onOpenStudio}>Open studio</Button>
    </div>
  );
}
