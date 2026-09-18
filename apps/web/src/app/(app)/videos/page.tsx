"use client";

import type { ProviderVideo } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Panel } from "@/components/console/layout";
import { StatusPill } from "@/components/StatusPill";
import { Alert, EmptyState, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function VideosPage() {
  const [items, setItems] = useState<ProviderVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: ProviderVideo[] }>(
        "/v1/console/videos",
        signal,
      );
      setItems(data.items);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Streaming"
        title="Videos"
        description="Recordings produced from live inputs (no re-encode)."
      />

      {error && <Alert>{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState
          title="No videos yet"
          body="When a recorded live input ends, the VOD appears here."
        />
      ) : (
        <Panel>
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Video</th>
                <th className="px-4 py-2.5 font-semibold">Live input</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-ink-800/80 hover:bg-ink-900/30 border-t"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/videos/${item.id}`}
                      className="hover:underline"
                    >
                      {item.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/live-inputs/${item.liveInputId}`}
                      className="hover:underline"
                    >
                      {item.liveInputId}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="text-ink-500 px-4 py-3">
                    {item.durationSeconds != null
                      ? `${Math.round(item.durationSeconds)}s`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

