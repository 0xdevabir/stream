"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  PageHeader,
  Panel,
  StatCard,
} from "@/components/console/layout";
import { Alert, CopyField, Spinner } from "@/components/ui";
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

export default function SettingsPage() {
  const [me, setMe] = useState<ConsoleMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<ConsoleMe>("/v1/console/me", signal);
      setMe(data);
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
        eyebrow="Tenant"
        title="Settings"
        description="Tenant identity and quota snapshot. Quotas are managed by the platform admin."
      />

      {error && <Alert>{error}</Alert>}

      {me && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Concurrent live"
              value={`${me.usage.concurrentLive} / ${me.tenant.maxConcurrentLives}`}
            />
            <StatCard
              label="Live minutes (month)"
              value={`${Math.round(me.usage.liveMinutes)} / ${me.tenant.maxMinutesPerMonth.toLocaleString()}`}
            />
            <StatCard
              label="Tokens issued"
              value={String(me.usage.tokensIssued)}
            />
          </div>

          <Panel title="Tenant">
            <div className="space-y-4 p-4">
              <CopyField label="Name" value={me.tenant.name} />
              <CopyField label="Slug" value={me.tenant.slug} />
              <CopyField label="Tenant id" value={me.tenant.id} />
            </div>
          </Panel>

          <Panel title="Quick links">
            <ul className="divide-ink-800/80 divide-y text-sm">
              <li>
                <Link
                  href="/api-keys"
                  className="hover:bg-ink-900/40 flex justify-between px-4 py-3"
                >
                  API keys <span className="text-ink-500">→</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/webhooks"
                  className="hover:bg-ink-900/40 flex justify-between px-4 py-3"
                >
                  Webhooks <span className="text-ink-500">→</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/guides/integration"
                  className="hover:bg-ink-900/40 flex justify-between px-4 py-3"
                >
                  Integration guide <span className="text-ink-500">→</span>
                </Link>
              </li>
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
