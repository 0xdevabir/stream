"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ClassCard } from "@/components/ClassCard";
import { Alert, Button, EmptyState, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { classNames } from "@/lib/format";
import { canTeach, useSession } from "@/lib/session";

type Filter = "all" | "LIVE" | "SCHEDULED" | "ENDED";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "LIVE", label: "Live now" },
  { value: "SCHEDULED", label: "Upcoming" },
  { value: "ENDED", label: "Past" },
];

export default function ClassesPage() {
  const { user } = useSession();
  const teaches = canTeach(user);

  const [filter, setFilter] = useState<Filter>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [items, setItems] = useState<StreamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams({ limit: "50" });
      if (filter !== "all") query.set("status", filter);
      if (mineOnly) query.set("mine", "true");

      try {
        const data = await api.get<{ items: StreamSummary[] }>(
          `/v1/streams?${query.toString()}`,
          signal,
        );
        setItems(data.items);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(errorMessage(cause, "Could not load classes"));
      } finally {
        setLoading(false);
      }
    },
    [filter, mineOnly],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Live viewer counts and status transitions matter on this screen, and the
  // list is small, so a slow poll is simpler than pushing it over a socket.
  useEffect(() => {
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const live = items.filter((item) => item.status === "LIVE");
  const rest = items.filter((item) => item.status !== "LIVE");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Classes</h1>

        <div className="bg-ink-900 border-ink-800 ml-auto flex rounded-lg border p-0.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={classNames(
                "rounded-md px-3 py-1.5 text-xs transition-colors",
                filter === option.value
                  ? "bg-ink-800 text-ink-100"
                  : "text-ink-500 hover:text-ink-300",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {teaches && (
          <label className="text-ink-500 flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(event) => setMineOnly(event.target.checked)}
              className="accent-brand-500 size-3.5"
            />
            Mine only
          </label>
        )}
      </header>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Spinner className="text-ink-500 size-6" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body={
            teaches
              ? "Create a class, then go live from your browser or from OBS."
              : "Classes you are enrolled in will appear here."
          }
          action={
            teaches ? (
              <Link href="/classes/new">
                <Button>Create a class</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {live.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-ink-500 text-xs font-semibold tracking-wide uppercase">
                Live now
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {live.map((stream) => (
                  <ClassCard
                    key={stream.id}
                    stream={stream}
                    manageable={teaches && stream.instructor.id === user?.id}
                  />
                ))}
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section className="space-y-3">
              {live.length > 0 && (
                <h2 className="text-ink-500 text-xs font-semibold tracking-wide uppercase">
                  Everything else
                </h2>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((stream) => (
                  <ClassCard
                    key={stream.id}
                    stream={stream}
                    manageable={teaches && stream.instructor.id === user?.id}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
