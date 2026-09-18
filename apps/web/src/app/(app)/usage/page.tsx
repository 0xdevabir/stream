"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Usage = {
  liveMinutes: number;
  tokensIssued: number;
  concurrentLive: number;
  maxConcurrentLives: number;
  maxMinutesPerMonth: number;
};

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<Usage>("/v1/console/usage", signal);
      setUsage(data);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Metering for the current UTC month. Billing UI is not included in v1.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {usage && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Meter
            label="Concurrent live inputs"
            value={usage.concurrentLive}
            max={usage.maxConcurrentLives}
          />
          <Meter
            label="Live minutes"
            value={Math.round(usage.liveMinutes)}
            max={usage.maxMinutesPerMonth}
          />
          <div className="border-ink-800 bg-ink-900/40 rounded-xl border px-4 py-3 sm:col-span-2">
            <p className="text-ink-500 text-xs tracking-wide uppercase">
              Playback tokens issued
            </p>
            <p className="mt-1 font-mono text-2xl">{usage.tokensIssued}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Meter({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="border-ink-800 bg-ink-900/40 rounded-xl border px-4 py-3">
      <p className="text-ink-500 text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-1 font-mono text-2xl">
        {value} <span className="text-ink-500 text-base">/ {max}</span>
      </p>
      <div className="bg-ink-800 mt-3 h-1.5 overflow-hidden rounded-full">
        <div className="bg-brand-500 h-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
