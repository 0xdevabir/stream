"use client";

import type { LiveInput } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Panel } from "@/components/console/layout";
import { StatusPill } from "@/components/StatusPill";
import { Alert, Button, EmptyState, Field, Input, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function LiveInputsPage() {
  const [items, setItems] = useState<LiveInput[]>([]);
  const [name, setName] = useState("");
  const [record, setRecord] = useState(true);
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
        record,
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
    <div className="space-y-7">
      <PageHeader
        eyebrow="Streaming"
        title="Live inputs"
        description="Create an ingest endpoint, publish with OBS or WHIP, then mint playback tokens for your LMS."
      />

      {error && <Alert>{error}</Alert>}

      <form
        onSubmit={create}
        className="border-ink-800/80 from-ink-900/60 to-ink-950/40 flex flex-wrap items-end gap-3 rounded-xl border bg-gradient-to-b p-4"
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
        <label className="text-ink-300 mb-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={record}
            onChange={(e) => setRecord(e.target.checked)}
          />
          Record
        </label>
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
        <Panel>
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Record</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
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
                      href={`/live-inputs/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="text-ink-500 px-4 py-3 text-xs">
                    {item.record ? "yes" : "no"}
                  </td>
                  <td className="text-ink-500 px-4 py-3 text-xs">
                    {new Date(item.createdAt).toLocaleString()}
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

