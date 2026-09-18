"use client";

import type { LiveInput } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, EmptyState, Spinner } from "@/components/ui";
import { StatusPill } from "@/components/StatusPill";
import { api, errorMessage } from "@/lib/api";

type ConsoleMe = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    maxConcurrentLives: number;
    maxMinutesPerMonth: number;
  };
  usage: {
    concurrentLive: number;
    liveMinutes: number;
    tokensIssued: number;
  };
};

export default function DashboardPage() {
  const [me, setMe] = useState<ConsoleMe | null>(null);
  const [inputs, setInputs] = useState<LiveInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [profile, list] = await Promise.all([
        api.get<ConsoleMe>("/v1/console/me", signal),
        api.get<{ items: LiveInput[] }>("/v1/console/live_inputs", signal),
      ]);
      setMe(profile);
      setInputs(list.items.slice(0, 8));
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(errorMessage(cause, "Could not load console"));
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-ink-500 mt-1 text-sm">
            {me?.tenant.name ?? "Tenant"} · developer console
          </p>
        </div>
        <Button onClick={() => (window.location.href = "/live-inputs")}>
          New live input
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {me && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Concurrent live"
            value={`${me.usage.concurrentLive} / ${me.tenant.maxConcurrentLives}`}
          />
          <Stat
            label="Live minutes (month)"
            value={`${Math.round(me.usage.liveMinutes)} / ${me.tenant.maxMinutesPerMonth}`}
          />
          <Stat label="Tokens issued (month)" value={String(me.usage.tokensIssued)} />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-wide uppercase text-ink-500">
            Recent live inputs
          </h2>
          <Link href="/live-inputs" className="text-brand-400 text-sm hover:underline">
            View all
          </Link>
        </div>

        {inputs.length === 0 ? (
          <EmptyState
            title="No live inputs yet"
            body="Create a live input, give OBS the ingest credentials, then mint a playback token for your LMS."
            action={
              <Button onClick={() => (window.location.href = "/live-inputs")}>
                Create live input
              </Button>
            }
          />
        ) : (
          <div className="border-ink-800 overflow-hidden rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-900/60 text-ink-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((item) => (
                  <tr key={item.id} className="border-ink-800 border-t">
                    <td className="px-4 py-3">
                      <Link
                        href={`/live-inputs/${item.id}`}
                        className="text-ink-100 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <p className="text-ink-600 font-mono text-[11px]">{item.id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="text-ink-500 px-4 py-3">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-ink-800 bg-ink-900/40 rounded-xl border px-4 py-3">
      <p className="text-ink-500 text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
