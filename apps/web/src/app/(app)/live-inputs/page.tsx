"use client";

import type { LiveInput } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StatusPill } from "@/components/StatusPill";
import { Alert, Button, EmptyState, Field, Input, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function LiveInputsPage() {
  const [items, setItems] = useState<LiveInput[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: LiveInput[] }>(
        "/v1/console/live_inputs",
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
    setCreating(true);
    setError(null);
    try {
      const created = await api.post<LiveInput>("/v1/console/live_inputs", {
        name: name.trim() || "Untitled live input",
        record: true,
      });
      setName("");
      window.location.href = `/live-inputs/${created.id}`;
    } catch (cause) {
      setError(errorMessage(cause, "Could not create live input"));
      setCreating(false);
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
        <h1 className="text-2xl font-semibold tracking-tight">Live inputs</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Create an ingest endpoint, publish with OBS or WHIP, then mint playback
          tokens for your LMS.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <form
        onSubmit={create}
        className="border-ink-800 bg-ink-900/30 flex flex-wrap items-end gap-3 rounded-xl border p-4"
      >
        <div className="min-w-[16rem] flex-1">
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="CS101 — Lecture 4"
            />
          </Field>
        </div>
        <Button type="submit" loading={creating}>
          Create
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="No live inputs"
          body="Create one to get RTMP / SRT / WHIP credentials."
        />
      ) : (
        <div className="border-ink-800 overflow-hidden rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/60 text-ink-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Record</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-ink-800 border-t">
                  <td className="px-4 py-3">
                    <Link
                      href={`/live-inputs/${item.id}`}
                      className="hover:underline"
                    >
                      {item.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="text-ink-500 px-4 py-3">
                    {item.record ? "yes" : "no"}
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
    </div>
  );
}
