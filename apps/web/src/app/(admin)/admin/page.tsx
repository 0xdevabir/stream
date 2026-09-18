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

type Overview = {
  tenants: number;
  concurrentLive: number;
  videos: number;
  month: { liveMinutes: number; tokensIssued: number };
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const overview = await api.get<Overview>("/v1/admin/me", signal);
      setData(overview);
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
        title="Platform overview"
        description="Tenants, concurrent lives, and monthly usage across the platform."
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

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Tenants" value={String(data.tenants)} />
          <StatCard
            label="Live now"
            value={String(data.concurrentLive)}
            hint="All tenants"
          />
          <StatCard label="Videos" value={String(data.videos)} />
          <StatCard
            label="Live minutes (month)"
            value={String(Math.round(data.month.liveMinutes))}
          />
          <StatCard
            label="Tokens issued (month)"
            value={String(data.month.tokensIssued)}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Operations">
          <ul className="divide-ink-800/80 divide-y text-sm">
            <li>
              <Link
                href="/admin/tenants"
                className="hover:bg-ink-900/40 flex items-center justify-between px-4 py-3 transition-colors"
              >
                <span>
                  <span className="font-medium">Manage tenants</span>
                  <span className="text-ink-500 mt-0.5 block text-xs">
                    Quotas, console users, API keys
                  </span>
                </span>
                <span className="text-ink-500" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/admin/live"
                className="hover:bg-ink-900/40 flex items-center justify-between px-4 py-3 transition-colors"
              >
                <span>
                  <span className="font-medium">Live inputs</span>
                  <span className="text-ink-500 mt-0.5 block text-xs">
                    Platform-wide status and force-cancel
                  </span>
                </span>
                <span className="text-ink-500" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/admin/usage"
                className="hover:bg-ink-900/40 flex items-center justify-between px-4 py-3 transition-colors"
              >
                <span>
                  <span className="font-medium">Usage by tenant</span>
                  <span className="text-ink-500 mt-0.5 block text-xs">
                    Minutes, tokens, concurrency
                  </span>
                </span>
                <span className="text-ink-500" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/admin/tenants/new"
                className="hover:bg-ink-900/40 flex items-center justify-between px-4 py-3 transition-colors"
              >
                <span>
                  <span className="font-medium">Provision a customer</span>
                  <span className="text-ink-500 mt-0.5 block text-xs">
                    Issues API key + console login once
                  </span>
                </span>
                <span className="text-ink-500" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          </ul>
        </Panel>

        <Panel title="Developers">
          <ul className="divide-ink-800/80 divide-y text-sm">
            <li>
              <Link
                href="/guides/integration"
                className="hover:bg-ink-900/40 flex items-center justify-between px-4 py-3 transition-colors"
              >
                <span>
                  <span className="font-medium">Integration guide</span>
                  <span className="text-ink-500 mt-0.5 block text-xs">
                    LMS wiring, tokens, embed
                  </span>
                </span>
                <span className="text-ink-500" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/dashboard"
                className="hover:bg-ink-900/40 flex items-center justify-between px-4 py-3 transition-colors"
              >
                <span>
                  <span className="font-medium">Open tenant console</span>
                  <span className="text-ink-500 mt-0.5 block text-xs">
                    If you also have a tenant membership
                  </span>
                </span>
                <span className="text-ink-500" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
