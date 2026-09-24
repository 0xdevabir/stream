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
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-3">
        <h1 className="page-title mr-auto">Classes</h1>

        <div className="bg-ink-900 border-ink-800 flex max-w-full overflow-x-auto rounded-full border p-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={classNames(
                "rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition-colors",
                filter === option.value
                  ? "bg-brand-500/20 text-ink-100"
                  : "text-ink-500 hover:text-ink-300",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {teaches && (
          <label className="text-ink-500 hover:text-ink-300 flex cursor-pointer items-center gap-2 text-xs font-bold">
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
          title="No classes yet"
          body={
            teaches
              ? "Create one and go live from your browser or OBS."
              : "Your classes will show up here."
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
            <section className="space-y-4">
              <h2 className="text-ink-500 text-[11px] font-bold tracking-[0.14em] uppercase">
                Live now
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <section className="space-y-4">
              {live.length > 0 && (
                <h2 className="text-ink-500 text-[11px] font-bold tracking-[0.14em] uppercase">
                  All classes
                </h2>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
