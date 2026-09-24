"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";

import { StatusBadge, ViewerPill } from "@/components/ui";
import { classNames, formatDateTime, formatRelative } from "@/lib/format";

export function ClassCard({
  stream,
  manageable,
  index = 0,
}: {
  stream: StreamSummary;
  manageable: boolean;
  /** Position in the grid, used to stagger the entrance. */
  index?: number;
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
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={classNames(
        "card animate-page-in group relative flex flex-col gap-4 p-5",
        "ease-ios transition-[transform,box-shadow] duration-300 hover:shadow-[0_8px_30px_rgb(0_0_0/0.08)] has-[a:active]:scale-[0.98] has-[a:active]:duration-100",
        live && "ring-live-500/50 ring-2",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={stream.status} />
        {live && <ViewerPill count={stream.viewerCount} />}
        <span className="text-ink-500 ml-auto truncate text-[13px]">
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
        <h3 className="line-clamp-2 text-[17px] leading-snug font-semibold">
          <Link href={href} className="after:absolute after:inset-0">
            {stream.title}
          </Link>
        </h3>
        <p className="text-ink-500 mt-0.5 text-[15px]">{stream.instructor.name}</p>
      </div>

      <div className="relative mt-auto flex flex-wrap items-center gap-2">
        <Link
          href={href}
          className={classNames(
            "inline-flex h-8 items-center rounded-full px-4 text-[13px] font-semibold transition-colors",
            live
              ? "bg-live-500 text-white"
              : "bg-brand-500/12 text-brand-500 hover:bg-brand-500/18",
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
                className="bg-ink-850 text-ink-100 hover:bg-ink-800 inline-flex h-8 items-center rounded-full px-4 text-[13px] font-semibold transition-colors"
              >
                {live ? "Studio" : "Go live"}
              </Link>
            )}
            <Link
              href={`/classes/${stream.id}/manage`}
              className="text-brand-500 inline-flex h-8 items-center px-2 text-[13px] font-semibold transition-opacity active:opacity-50"
            >
              Manage
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
