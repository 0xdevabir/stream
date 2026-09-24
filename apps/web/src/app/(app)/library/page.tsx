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
        <h1 className="page-title">Recordings</h1>
      </header>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Spinner className="text-ink-500 size-6" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No recordings yet"
          body="Recorded classes show up here after they end."
        />
      ) : (
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((recording, index) => (
            <article
              key={recording.id}
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              className="animate-page-in group"
            >
              <Link
                href={`/replay/${recording.id}`}
                className="ease-ios block transition-transform duration-300 active:scale-[0.97] active:duration-100"
              >
                <div className="bg-ink-850 relative aspect-video overflow-hidden rounded-[18px] shadow-[0_2px_10px_rgb(0_0_0/0.08)]">
                  {recording.posterUrl ? (
                    // Posters are served through the same authorized /vod path
                    // as the segments, so a plain <img> is enough.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={recording.posterUrl}
                      alt=""
                      className="ease-ios size-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="text-ink-500 grid size-full place-items-center">
                      <svg viewBox="0 0 16 16" className="size-8 fill-current" aria-hidden>
                        <path d="M4 2.5v11l9.5-5.5z" />
                      </svg>
                    </div>
                  )}
                  {recording.durationSeconds !== null && (
                    <span className="font-rounded absolute right-2 bottom-2 rounded-full bg-black/45 px-2 py-0.5 text-xs font-semibold text-white tabular-nums backdrop-blur-xl">
                      {formatClock(recording.durationSeconds)}
                    </span>
                  )}
                </div>
              </Link>

              <div className="px-1 pt-2.5">
                <h3 className="truncate text-[15px] font-semibold">
                  <Link href={`/replay/${recording.id}`}>
                    {recording.title}
                  </Link>
                </h3>
                <p className="text-ink-500 mt-0.5 text-[13px]">
                  {formatDateTime(recording.createdAt)} ·{" "}
                  {formatBytes(recording.sizeBytes)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
