"use client";

import type { PlaybackTokenResponse, ProviderVideo } from "@stream/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StatusPill } from "@/components/StatusPill";
import { Player } from "@/components/player/Player";
import { Alert, Button, CopyField, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<ProviderVideo | null>(null);
  const [token, setToken] = useState<PlaybackTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await api.get<ProviderVideo>(
          `/v1/console/videos/${id}`,
          signal,
        );
        setItem(data);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const mintToken = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await api.post<PlaybackTokenResponse>(
        `/v1/console/live_inputs/${item.liveInputId}/token`,
        { ttlSeconds: 3600 },
      );
      setToken(grant);
    } catch (cause) {
      setError(errorMessage(cause, "Could not mint token"));
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

  if (!item) {
    return <Alert>{error ?? "Video not found"}</Alert>;
  }

  const previewSrc =
    token?.signedVodUrl ??
    token?.signedHlsUrl ??
    (token?.token && item.vodUrl
      ? `${item.vodUrl}?token=${encodeURIComponent(token.token)}`
      : null);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-ink-500 text-xs">
            <Link href="/videos" className="hover:underline">
              Videos
            </Link>
          </p>
          <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight">
            {item.id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill status={item.status} />
            <Link
              href={`/live-inputs/${item.liveInputId}`}
              className="text-ink-500 font-mono text-xs hover:underline"
            >
              {item.liveInputId}
            </Link>
          </div>
        </div>
        <Button
          variant="secondary"
          loading={busy}
          disabled={item.status !== "READY"}
          onClick={() => void mintToken()}
        >
          Mint playback token
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      <section className="border-ink-800 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <CopyField label="VOD URL" value={item.vodUrl ?? "—"} />
        <CopyField label="Download URL" value={item.downloadUrl ?? "—"} />
        <p className="text-ink-500 text-xs sm:col-span-2">
          Duration{" "}
          {item.durationSeconds != null
            ? `${Math.round(item.durationSeconds)}s`
            : "—"}
          {item.sizeBytes != null
            ? ` · ${Math.round(item.sizeBytes / 1024 / 1024)} MB`
            : ""}
          {item.readyAt
            ? ` · ready ${new Date(item.readyAt).toLocaleString()}`
            : ""}
        </p>
      </section>

      {token && (
        <section className="border-ink-800 space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">Playback grant</h2>
          <CopyField
            label="Signed VOD URL"
            value={token.signedVodUrl ?? token.signedHlsUrl ?? "(unavailable)"}
          />
          <CopyField label="Token" value={token.token} masked />
          <div className="bg-ink-950 overflow-hidden rounded-lg">
            <Player
              src={previewSrc}
              live={false}
              playbackToken={token.token}
              placeholder={
                <p className="text-ink-500 p-8 text-center text-sm">
                  Waiting for playlist…
                </p>
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
