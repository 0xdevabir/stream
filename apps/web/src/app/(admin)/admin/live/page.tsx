"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Panel } from "@/components/console/layout";
import { StatusPill } from "@/components/StatusPill";
import { Alert, Button, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type LiveRow = {
  id: string;
  name: string;
  status: string;
  recordEnabled: boolean;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  createdAt: string;
  startedAt: string | null;
};

export default function AdminLivePage() {
  const [items, setItems] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: LiveRow[] }>(
        "/v1/admin/live_inputs",
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
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const cancel = async (tenantId: string | null, liveId: string) => {
    if (!tenantId) return;
    if (!confirm("Force-cancel this live input?")) return;
    setBusy(liveId);
    try {
      await api.del(`/v1/admin/tenants/${tenantId}/live_inputs/${liveId}`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

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
        title="Live inputs"
        description="All tenant live inputs across the platform."
      />

      {error && <Alert>{error}</Alert>}

      <Panel>
        {items.length === 0 ? (
          <p className="text-ink-500 px-4 py-8 text-center text-sm">
            No live inputs yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Input</th>
                <th className="px-4 py-2.5 font-semibold">Tenant</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Record</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-ink-800/80 hover:bg-ink-900/30 border-t"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-ink-600 font-mono text-[11px]">
                      {item.id}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {item.tenantId ? (
                      <Link
                        href={`/admin/tenants/${item.tenantId}`}
                        className="hover:underline"
                      >
                        {item.tenantName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="text-ink-500 px-4 py-3 text-xs">
                    {item.recordEnabled ? "yes" : "no"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.status === "LIVE" || item.status === "SCHEDULED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === item.id}
                        onClick={() => void cancel(item.tenantId, item.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
