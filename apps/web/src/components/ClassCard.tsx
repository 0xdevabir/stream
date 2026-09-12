"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";

import { StatusBadge, ViewerPill } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";

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

  return (
    <article className="card hover:border-ink-700 flex flex-col gap-3 p-4 transition-colors">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={stream.status} />
            {stream.status === "LIVE" && <ViewerPill count={stream.viewerCount} />}
          </div>

          <h3 className="truncate font-medium">
            <Link href={href} className="hover:underline">
              {stream.title}
            </Link>
          </h3>

          <p className="text-ink-500 mt-0.5 text-xs">
            {stream.instructor.name}
            {" · "}
            {stream.status === "SCHEDULED" && stream.scheduledAt
              ? `starts ${formatRelative(stream.scheduledAt)}`
              : stream.status === "LIVE" && stream.startedAt
                ? `live since ${formatDateTime(stream.startedAt)}`
                : stream.endedAt
                  ? `ended ${formatRelative(stream.endedAt)}`
                  : formatDateTime(stream.scheduledAt)}
          </p>
        </div>
      </div>

      {stream.description && (
        <p className="text-ink-300 line-clamp-2 text-sm">{stream.description}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link
          href={href}
          className="bg-ink-800 hover:bg-ink-700 rounded-lg px-3 py-1.5 text-xs font-medium"
        >
          {stream.status === "LIVE"
            ? "Watch live"
            : stream.status === "ENDED" && stream.recordingId
              ? "Watch replay"
              : "Open"}
        </Link>

        {manageable && (
          <>
            <Link
              href={`/classes/${stream.id}/manage`}
              className="text-ink-500 hover:text-ink-100 rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              Manage
            </Link>
            {stream.status !== "ENDED" && stream.status !== "CANCELLED" && (
              <Link
                href={`/classes/${stream.id}/studio`}
                className="bg-live-500 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
              >
                {stream.status === "LIVE" ? "Control room" : "Go live"}
              </Link>
            )}
          </>
        )}
      </div>
    </article>
  );
}
