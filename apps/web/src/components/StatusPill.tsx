"use client";

import { classNames } from "@/lib/format";

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "LIVE"
      ? "bg-live-500/20 text-live-400"
      : status === "ENDED" || status === "READY"
        ? "bg-ink-800 text-ink-300"
        : status === "FAILED" || status === "CANCELLED"
          ? "bg-live-500/10 text-live-500"
          : "bg-brand-600/15 text-brand-300";

  return (
    <span
      className={classNames(
        "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        tone,
      )}
    >
      {status}
    </span>
  );
}
