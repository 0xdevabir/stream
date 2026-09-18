"use client";

import { useCallback, useEffect, useState } from "react";

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

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export default function ApiKeysPage() {
  const [items, setItems] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState("LMS production");
  const [createdRaw, setCreatedRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: ApiKeyRow[] }>(
        "/v1/console/api-keys",
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

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreatedRaw(null);
    try {
      const created = await api.post<ApiKeyRow & { apiKey: string }>(
        "/v1/console/api-keys",
        { name },
      );
      setCreatedRaw(created.apiKey);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this API key? Integrations using it will fail.")) return;
    setBusy(true);
    try {
      await api.del(`/v1/console/api-keys/${id}`);
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Server-side keys for <code className="text-ink-300">/v1/provider/*</code>.
          Never put these in a browser.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {createdRaw && (
        <Alert>
          <p className="mb-2 font-medium">Copy this key now — it will not be shown again.</p>
          <CopyField label="API key" value={createdRaw} />
        </Alert>
      )}

      <form
        onSubmit={create}
        className="border-ink-800 bg-ink-900/30 flex flex-wrap items-end gap-3 rounded-xl border p-4"
      >
        <div className="min-w-[16rem] flex-1">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" loading={busy}>
          Create key
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState title="No API keys" body="Create a key for your LMS backend." />
      ) : (
        <div className="border-ink-800 overflow-hidden rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/60 text-ink-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Prefix</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-ink-800 border-t">
                  <td className="px-4 py-3">
                    {item.name}
                    {item.revokedAt && (
                      <span className="text-live-500 ml-2 text-xs">revoked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{item.keyPrefix}…</td>
                  <td className="text-ink-500 px-4 py-3">
                    {item.lastUsedAt
                      ? new Date(item.lastUsedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!item.revokedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void revoke(item.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
