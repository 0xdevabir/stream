"use client";

import type { StreamHealth, StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useConfirm } from "@/components/dialog";
import { IngestPanel, type IngestCredentials } from "@/components/IngestPanel";
import {
  Alert,
  Button,
  CopyField,
  EmptyState,
  Spinner,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { classNames, formatBitrate, formatClock, formatRelative } from "@/lib/format";

/**
 * Every stream in the organization with what an integrator needs to run it:
 * the OBS credentials, a live encoder readout, and the ids their backend
 * calls the API with.
 */
export function StreamsConsole() {
  const [items, setItems] = useState<StreamSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: StreamSummary[] }>("/v1/streams?limit=100");
      setItems(data.items);
      setError(null);
      setSelectedId((current) => current ?? pickDefault(data.items));
    } catch (cause) {
      setError(errorMessage(cause, "Could not load streams"));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!items) {
    return error ? <Alert>{error}</Alert> : <Centered />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No streams yet"
        body="Create one with POST /v1/streams or from the app."
        action={
          <Link href="/classes/new">
            <Button>New stream</Button>
          </Link>
        }
      />
    );
  }

  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="card flex max-h-[70dvh] flex-col overflow-hidden lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <p className="text-[17px] font-semibold">
            Streams <span className="text-ink-500">{items.length}</span>
          </p>
          <Link href="/classes/new" className="ml-auto">
            <Button size="sm">New</Button>
          </Link>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={classNames(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 active:scale-[0.98]",
                  item.id === selectedId ? "bg-brand-500/12" : "hover:bg-ink-850",
                )}
              >
                <StatusDot status={item.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{item.title}</span>
                  <span className="text-ink-500 block truncate font-mono text-[11px]">
                    {item.id}
                  </span>
                </span>
                {item.status === "LIVE" && (
                  <span className="text-ink-500 text-[13px] tabular-nums">
                    {item.viewerCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <StreamDetail key={selected.id} stream={selected} onChanged={() => void load()} />
      ) : (
        <Centered />
      )}
    </div>
  );
}

function pickDefault(items: StreamSummary[]): string | null {
  return (items.find((item) => item.status === "LIVE") ?? items[0])?.id ?? null;
}

type IngestResponse = IngestCredentials & { whipUrl: string; ladder: string[] };

function StreamDetail({
  stream,
  onChanged,
}: {
  stream: StreamSummary;
  onChanged: () => void;
}) {
  const [ingest, setIngest] = useState<IngestResponse | null>(null);
  const [health, setHealth] = useState<StreamHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"rotate" | "end" | null>(null);
  const confirm = useConfirm();

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const closed = stream.status === "ENDED" || stream.status === "CANCELLED";

  useEffect(() => {
    api
      .get<IngestResponse>(`/v1/streams/${stream.id}/ingest`)
      .then(setIngest)
      .catch((cause) => setError(errorMessage(cause, "Could not load ingest credentials")));
  }, [stream.id]);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      api
        .get<StreamHealth>(`/v1/streams/${stream.id}/health`)
        .then((data) => {
          if (!cancelled) setHealth(data);
        })
        .catch(() => undefined);
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stream.id]);

  // Health is fresher than the list, which only refreshes every 15 seconds.
  const status = health?.status ?? stream.status;
  const encoder = health?.encoder;
  const uptime = encoder?.connectedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(encoder.connectedAt).getTime()) / 1000))
    : null;

  const rotate = async () => {
    const ok = await confirm({
      title: "Rotate stream key?",
      message: "A connected encoder is disconnected.",
      confirmLabel: "Rotate",
      destructive: true,
    });
    if (!ok) return;
    setBusy("rotate");
    try {
      const data = await api.post<{ ingest: IngestCredentials }>(
        `/v1/streams/${stream.id}/key/rotate`,
      );
      setIngest((current) => (current ? { ...current, ...data.ingest } : current));
    } catch (cause) {
      setError(errorMessage(cause, "Could not rotate the key"));
    } finally {
      setBusy(null);
    }
  };

  const end = async () => {
    const ok = await confirm({
      title: "End this stream?",
      message: "It ends for everyone watching.",
      confirmLabel: "End",
      destructive: true,
    });
    if (!ok) return;
    setBusy("end");
    try {
      await api.post(`/v1/streams/${stream.id}/end`);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, "Could not end the stream"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {health?.paused ? (
              <span className="bg-warn-500/15 text-warn-500 inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-semibold">
                Paused
              </span>
            ) : (
              <StatusBadge status={status} />
            )}
            <span className="text-ink-500 text-xs">
              {formatRelative(stream.startedAt ?? stream.scheduledAt)}
            </span>
          </div>
          <h2 className="mt-2 truncate text-[28px] leading-tight font-bold">{stream.title}</h2>
        </div>
        <div className="flex gap-2">
          <a href={`/watch/${stream.slug}`} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">
              Watch
            </Button>
          </a>
          <Link href={`/classes/${stream.id}/manage`}>
            <Button variant="secondary" size="sm">
              Manage
            </Button>
          </Link>
          {status === "LIVE" && (
            <Button variant="danger" size="sm" loading={busy === "end"} onClick={() => void end()}>
              End
            </Button>
          )}
        </div>
      </header>

      {error && <Alert>{error}</Alert>}

      <section className="card p-5">
        <div className="mb-5 flex items-center gap-2.5">
          <span
            className={classNames(
              "size-2.5 rounded-full",
              encoder?.connected ? "bg-ok-500 live-dot" : "bg-ink-700",
            )}
          />
          <p className="text-[15px] font-semibold">
            {health === null
              ? "Checking encoder…"
              : encoder?.connected
                ? `Encoder connected${encoder.protocol ? ` · ${encoder.protocol.toUpperCase()}` : ""}`
                : "Waiting for encoder"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            label="Bitrate"
            value={encoder?.bitrateKbps ? formatBitrate(encoder.bitrateKbps * 1000) : "—"}
            tone={encoder?.bitrateKbps ? "good" : "default"}
          />
          <Stat label="Uptime" value={uptime !== null ? formatClock(uptime) : "—"} />
          <Stat label="Viewers" value={String(health?.viewers ?? stream.viewerCount)} />
          <Stat
            label="Tracks"
            value={encoder?.tracks.length ? encoder.tracks.map(shortCodec).join(" + ") : "—"}
          />
        </div>
      </section>

      {!closed && (
        <section className="card p-5">
          <h3 className="mb-4 text-[17px] font-semibold">OBS</h3>
          {ingest ? (
            <IngestPanel
              ingest={ingest}
              onRotate={() => void rotate()}
              rotating={busy === "rotate"}
            />
          ) : (
            <Centered />
          )}
        </section>
      )}

      <section className="card space-y-4 p-5">
        <h3 className="text-[17px] font-semibold">API</h3>
        <CopyField label="Stream ID" value={stream.id} />
        <CopyField label="Watch URL" value={`${origin}/watch/${stream.slug}`} />
        <pre className="bg-ink-850 overflow-x-auto rounded-2xl p-4 font-mono text-[12px] leading-relaxed">
          {`curl ${origin}/v1/streams/${stream.id}/health \\
  -H "Authorization: Bearer $STREAM_API_KEY"`}
        </pre>
      </section>
    </div>
  );
}

function shortCodec(track: string): string {
  if (/mpeg-4 audio/i.test(track)) return "AAC";
  return track;
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={classNames(
        "size-2 shrink-0 rounded-full",
        status === "LIVE" && "bg-live-500 live-dot",
        status === "SCHEDULED" && "bg-ink-300",
        status === "PROCESSING" && "bg-brand-500",
        (status === "ENDED" || status === "CANCELLED") && "bg-ink-700",
      )}
    />
  );
}

function Centered() {
  return (
    <div className="grid place-items-center py-10">
      <Spinner className="text-ink-500 size-5" />
    </div>
  );
}
