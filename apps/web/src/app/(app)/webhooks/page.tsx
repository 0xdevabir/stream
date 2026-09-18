"use client";

import { PROVIDER_WEBHOOK_EVENTS } from "@stream/shared";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Panel } from "@/components/console/layout";
import {
  Alert,
  Button,
  CopyField,
  EmptyState,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type HookRow = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  secret?: string;
};

export default function WebhooksPage() {
  const [items, setItems] = useState<HookRow[]>([]);
  const [url, setUrl] = useState("https://example.com/webhooks/stream");
  const [events, setEvents] = useState<string[]>([...PROVIDER_WEBHOOK_EVENTS]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: HookRow[] }>(
        "/v1/console/webhooks",
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

  const toggleEvent = (event: string) => {
    setEvents((current) =>
      current.includes(event)
        ? current.filter((value) => value !== event)
        : [...current, event],
    );
  };

  const create = async (form: React.FormEvent) => {
    form.preventDefault();
    if (events.length === 0) {
      setError("Select at least one event");
      return;
    }
    setBusy(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const created = await api.post<HookRow>("/v1/console/webhooks", {
        url,
        events,
      });
      setCreatedSecret(created.secret ?? null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/v1/console/webhooks/${id}`, { enabled });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this webhook endpoint?")) return;
    setBusy(true);
    try {
      await api.del(`/v1/console/webhooks/${id}`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
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
        eyebrow="Access"
        title="Webhooks"
        description="Receive live.started, live.ended, and video lifecycle events in your LMS."
      />

      {error && <Alert>{error}</Alert>}

      {createdSecret && (
        <Alert>
          <p className="mb-2 font-medium">Webhook signing secret (shown once)</p>
          <CopyField label="Secret" value={createdSecret} />
        </Alert>
      )}

      <form
        onSubmit={create}
        className="border-ink-800/80 from-ink-900/60 to-ink-950/40 space-y-4 rounded-xl border bg-gradient-to-b p-4"
      >
        <Field label="Endpoint URL">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <div>
          <p className="label">Events</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {PROVIDER_WEBHOOK_EVENTS.map((event) => (
              <label
                key={event}
                className="text-ink-300 flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                {event}
              </label>
            ))}
          </div>
        </div>
        <Button type="submit" loading={busy}>
          Add endpoint
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="No webhooks"
          body="Add an HTTPS endpoint to get events."
        />
      ) : (
        <Panel>
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">URL</th>
                <th className="px-4 py-2.5 font-semibold">Events</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-ink-800/80 border-t">
                  <td className="max-w-xs truncate px-4 py-3 font-mono text-xs">
                    {item.url}
                  </td>
                  <td className="text-ink-500 px-4 py-3 text-xs">
                    {item.events.join(", ")}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {item.enabled ? (
                      <span className="text-brand-400">enabled</span>
                    ) : (
                      <span className="text-ink-500">disabled</span>
                    )}
                  </td>
                  <td className="space-x-2 px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void setEnabled(item.id, !item.enabled)}
                    >
                      {item.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    >
                      Delete
                    </Button>
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
