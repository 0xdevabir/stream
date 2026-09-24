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
      <p className="text-ink-500 text-[13px]">
        OBS → Settings → Stream → Custom. Keyframe interval 1s.
      </p>

      <CopyField label="RTMP server" value={ingest.rtmp.url} />

      <div>
        <CopyField
          label="Stream key"
          value={ingest.rtmp.streamKey}
          masked={!revealed}
        />
        <div className="mt-2 ml-1 flex gap-4">
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            className="text-brand-500 text-[13px] font-medium transition-opacity active:opacity-50"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
          {onRotate && (
            <button
              type="button"
              onClick={onRotate}
              disabled={rotating}
              className="text-live-500 text-[13px] font-medium transition-opacity active:opacity-50 disabled:opacity-50"
            >
              {rotating ? "Rotating…" : "Rotate key"}
            </button>
          )}
        </div>
      </div>

      <details className="group/srt">
        <summary className="text-brand-500 ml-1 flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
          <svg viewBox="0 0 12 12" className="size-2.5 transition-transform duration-300 group-open/srt:rotate-90" fill="none" aria-hidden>
            <path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          SRT
        </summary>
        <div className="animate-fade-in pt-3">
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
        <p className="text-ink-500 ml-1 text-[13px]">Anyone with this link can watch.</p>
      )}
    </div>
  );
}

export function GoLiveHint({ onOpenStudio }: { onOpenStudio: () => void }) {
  return (
    <div className="bg-brand-500/10 flex flex-wrap items-center gap-3 rounded-[22px] p-4 pl-5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Go live from your browser</p>
      </div>
      <Button onClick={onOpenStudio}>Open studio</Button>
    </div>
  );
}
