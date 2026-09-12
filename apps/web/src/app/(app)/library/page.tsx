"use client";

import type { Recording } from "@stream/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, EmptyState, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, formatClock, formatDateTime } from "@/lib/format";

export default function LibraryPage() {
  const [items, setItems] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ items: Recording[] }>("/v1/recordings?limit=100", controller.signal)
      .then((data) => setItems(data.items))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "Could not load recordings"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Recordings</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Every recorded class, ready to replay. Recordings are encrypted the
          same way the live stream was.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Spinner className="text-ink-500 size-6" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No recordings yet"
          body="Classes with recording enabled appear here a minute or so after they end."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((recording) => (
            <article key={recording.id} className="card overflow-hidden">
              <Link href={`/replay/${recording.id}`} className="block">
                <div className="bg-ink-950 relative aspect-video">
                  {recording.posterUrl ? (
                    // Posters are served through the same authorized /vod path
                    // as the segments, so a plain <img> is enough.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={recording.posterUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="text-ink-700 grid size-full place-items-center text-3xl">
                      ▶
                    </div>
                  )}
                  {recording.durationSeconds !== null && (
                    <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums">
                      {formatClock(recording.durationSeconds)}
                    </span>
                  )}
                </div>
              </Link>

              <div className="p-3">
                <h3 className="truncate text-sm font-medium">
                  <Link href={`/replay/${recording.id}`} className="hover:underline">
                    {recording.title}
                  </Link>
                </h3>
                <p className="text-ink-500 mt-1 text-xs">
                  {formatDateTime(recording.createdAt)} ·{" "}
                  {formatBytes(recording.sizeBytes)}
                </p>
                <p className="text-ink-500 mt-0.5 text-[11px]">
                  {recording.renditions.join(" · ")}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
