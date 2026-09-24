"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";

import { StatusBadge, ViewerPill } from "@/components/ui";
import { classNames, formatDateTime, formatRelative } from "@/lib/format";

export function ClassCard({
  stream,
  manageable,
}: {
  stream: StreamSummary;
  manageable: boolean;
}) {
  // Where the primary click goes depends on what the class is doing: a live
  // one should be watchable in one click, an ended one replayable.
  const href =
    stream.status === "ENDED" && stream.recordingId
      ? `/replay/${stream.recordingId}`
      : `/watch/${stream.slug}`;
  const live = stream.status === "LIVE";

  return (
    <article
      className={classNames(
        "card group hover:border-ink-700 relative flex flex-col gap-4 p-5 transition-all duration-200 hover:-translate-y-0.5",
        live && "border-live-500/40 hover:border-live-500/70",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={stream.status} />
        {live && <ViewerPill count={stream.viewerCount} />}
        <span className="text-ink-500 ml-auto truncate text-xs">
          {stream.status === "SCHEDULED" && stream.scheduledAt
            ? formatRelative(stream.scheduledAt)
            : live && stream.startedAt
              ? `since ${formatDateTime(stream.startedAt)}`
              : stream.endedAt
                ? formatRelative(stream.endedAt)
                : formatDateTime(stream.scheduledAt)}
        </span>
      </div>

      <div className="min-w-0">
        <h3 className="line-clamp-2 text-lg leading-snug font-black">
          <Link href={href} className="after:absolute after:inset-0">
            {stream.title}
          </Link>
        </h3>
        <p className="text-ink-500 mt-1 text-sm">{stream.instructor.name}</p>
      </div>

      <div className="relative mt-auto flex flex-wrap gap-2">
        <Link
          href={href}
          className={classNames(
            "rounded-full px-4 py-2 text-xs font-bold transition-colors",
            live
              ? "bg-live-500 text-white hover:brightness-110"
              : "bg-beige text-ink-950 hover:bg-brand-500",
          )}
        >
          {live
            ? "Watch live"
            : stream.status === "ENDED" && stream.recordingId
              ? "Watch replay"
              : "Open"}
        </Link>

        {manageable && (
          <>
            {stream.status !== "ENDED" && stream.status !== "CANCELLED" && (
              <Link
                href={`/classes/${stream.id}/studio`}
                className="border-ink-700 hover:border-ink-500 rounded-full border px-4 py-2 text-xs font-bold transition-colors"
              >
                {live ? "Studio" : "Go live"}
              </Link>
            )}
            <Link
              href={`/classes/${stream.id}/manage`}
              className="text-ink-500 hover:text-ink-100 rounded-full px-3 py-2 text-xs font-bold transition-colors"
            >
              Manage
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
