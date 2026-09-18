"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  PageHeader,
  Panel,
  StatCard,
} from "@/components/console/layout";
import { Alert, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type UsageResponse = {
  monthStart: string;
  totals: {
    concurrentLive: number;
    liveMinutes: number;
    tokensIssued: number;
  };
  items: Array<{
    id: string;
    name: string;
    slug: string;
    concurrentLive: number;
    maxConcurrentLives: number;
    liveMinutes: number;
    maxMinutesPerMonth: number;
    tokensIssued: number;
  }>;
};

export default function AdminUsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const usage = await api.get<UsageResponse>("/v1/admin/usage", signal);
      setData(usage);
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
        eyebrow="Super admin"
        title="Platform usage"
        description={
          data
            ? `UTC month starting ${new Date(data.monthStart).toLocaleDateString()}`
            : "Per-tenant metering for the current month"
        }
      />

      {error && <Alert>{error}</Alert>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Concurrent live"
              value={String(data.totals.concurrentLive)}
            />
            <StatCard
              label="Live minutes"
              value={String(Math.round(data.totals.liveMinutes))}
            />
            <StatCard
              label="Tokens issued"
              value={String(data.totals.tokensIssued)}
            />
          </div>

          <Panel title="By tenant">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Tenant</th>
                  <th className="px-4 py-2.5 font-semibold">Live</th>
                  <th className="px-4 py-2.5 font-semibold">Minutes</th>
                  <th className="px-4 py-2.5 font-semibold">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-ink-800/80 hover:bg-ink-900/30 border-t"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/tenants/${item.id}`}
                        className="font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                      <p className="text-ink-500 font-mono text-xs">
                        {item.slug}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {item.concurrentLive} / {item.maxConcurrentLives}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {Math.round(item.liveMinutes)} /{" "}
                      {item.maxMinutesPerMonth.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {item.tokensIssued}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
