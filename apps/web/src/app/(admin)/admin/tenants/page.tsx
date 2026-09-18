"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Panel } from "@/components/console/layout";
import { Alert, EmptyState, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  maxConcurrentLives: number;
  maxMinutesPerMonth: number;
  concurrentLive: number;
  liveMinutes: number;
  tokensIssued: number;
  apiKeyCount: number;
  createdAt: string;
};

export default function AdminTenantsPage() {
  const [items, setItems] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: TenantRow[] }>(
        "/v1/admin/tenants",
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
        eyebrow="Super admin"
        title="Tenants"
        description="LMS customers and API consumers on this platform."
        actions={
          <Link
            href="/admin/tenants/new"
            className="bg-brand-600 hover:bg-brand-500 inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white"
          >
            Create tenant
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState
          title="No tenants"
          body="Create a tenant to issue API keys and a console login."
        />
      ) : (
        <Panel>
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Tenant</th>
                <th className="px-4 py-2.5 font-semibold">Live</th>
                <th className="px-4 py-2.5 font-semibold">Minutes</th>
                <th className="px-4 py-2.5 font-semibold">Caps</th>
                <th className="px-4 py-2.5 font-semibold">Keys</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-ink-800/80 hover:bg-ink-900/30 border-t transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tenants/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                    <p className="text-ink-500 font-mono text-xs">{item.slug}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {item.concurrentLive}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {Math.round(item.liveMinutes)}
                  </td>
                  <td className="text-ink-500 px-4 py-3 text-xs">
                    {item.maxConcurrentLives} concurrent ·{" "}
                    {item.maxMinutesPerMonth.toLocaleString()} min/mo
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {item.apiKeyCount}
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
