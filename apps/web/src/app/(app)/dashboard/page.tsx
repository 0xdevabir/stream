"use client";

import type { LiveInput } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  PageHeader,
  Panel,
  StatCard,
} from "@/components/console/layout";
import { StatusPill } from "@/components/StatusPill";
import { Alert, Button, EmptyState, Spinner } from "@/components/ui";
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
    <div className="space-y-7">
      <PageHeader
        eyebrow="Tenant console"
        title="Overview"
        description={
          me
            ? `${me.tenant.name} · live streaming & recordings for your LMS`
            : "Live streaming & recordings for your LMS"
        }
        actions={
          <Link
            href="/live-inputs"
            className="bg-brand-600 hover:bg-brand-500 inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white"
          >
            New live input
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}

      {me && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Concurrent live"
            value={`${me.usage.concurrentLive} / ${me.tenant.maxConcurrentLives}`}
            hint="Against your tenant cap"
          />
          <StatCard
            label="Live minutes (month)"
            value={`${Math.round(me.usage.liveMinutes)} / ${me.tenant.maxMinutesPerMonth.toLocaleString()}`}
          />
          <StatCard
            label="Tokens issued (month)"
            value={String(me.usage.tokensIssued)}
          />
        </div>
      )}

      <Panel
        title="Recent live inputs"
        action={
          <Link
            href="/live-inputs"
            className="text-brand-400 text-xs font-medium hover:underline"
          >
            View all
          </Link>
        }
      >
        {inputs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No live inputs yet"
              body="Create a live input, give OBS the ingest credentials, then mint a playback token for your LMS."
              action={
                <Link
                  href="/live-inputs"
                  className="bg-brand-600 hover:bg-brand-500 inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white"
                >
                  Create live input
                </Link>
              }
            />
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((item) => (
                <tr
                  key={item.id}
                  className="border-ink-800/80 hover:bg-ink-900/30 border-t transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/live-inputs/${item.id}`}
                      className="text-ink-100 font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                    <p className="text-ink-600 font-mono text-[11px]">
                      {item.id}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="text-ink-500 px-4 py-3 text-xs">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-3">
        <QuickLink href="/api-keys" title="API keys" body="For your LMS backend" />
        <QuickLink href="/embed" title="Embed & test" body="Mint a token and preview" />
        <QuickLink
          href="/guides/integration"
          title="Integration guide"
          body="Wire Stream into your app"
        />
      </div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="border-ink-800/80 hover:border-ink-700 hover:bg-ink-900/40 block rounded-xl border px-4 py-3 transition-colors"
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-ink-500 mt-0.5 text-xs">{body}</p>
    </Link>
  );
}
