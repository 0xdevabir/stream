"use client";

import type { LiveInput, PlaybackTokenResponse } from "@stream/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StatusPill } from "@/components/StatusPill";
import { IngestPanel } from "@/components/IngestPanel";
import { Player } from "@/components/player/Player";
import {
  Alert,
  Button,
  CopyField,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function LiveInputDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<LiveInput | null>(null);
  const [token, setToken] = useState<PlaybackTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await api.get<LiveInput>(
          `/v1/console/live_inputs/${id}`,
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
    const timer = setInterval(() => void load(), 8_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const mintToken = async () => {
    setBusy(true);
    setError(null);
    try {
      const grant = await api.post<PlaybackTokenResponse>(
        `/v1/console/live_inputs/${id}/token`,
        { ttlSeconds: 3600 },
      );
      setToken(grant);
    } catch (cause) {
      setError(errorMessage(cause, "Could not mint token"));
    } finally {
      setBusy(false);
    }
  };

  const endInput = async () => {
    if (!confirm("Cancel this live input? Publishers will be rejected.")) return;
    setBusy(true);
    try {
      await api.del(`/v1/console/live_inputs/${id}`);
      router.push("/live-inputs");
    } catch (cause) {
      setError(errorMessage(cause));
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
    return <Alert>{error ?? "Live input not found"}</Alert>;
  }

  const previewSrc =
    token?.signedHlsUrl ??
    token?.signedVodUrl ??
    (token?.token && item.playback.hlsUrl
      ? `${item.playback.hlsUrl}?token=${encodeURIComponent(token.token)}`
      : null);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-ink-500 text-xs">
            <Link href="/live-inputs" className="hover:underline">
              Live inputs
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {item.name}
          </h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusPill status={item.status} />
            <span className="text-ink-600 font-mono text-xs">{item.id}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" loading={busy} onClick={() => void mintToken()}>
            Mint playback token
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void endInput()}>
            Cancel
          </Button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <section className="border-ink-800 space-y-4 rounded-xl border p-4">
        <IngestPanel
          ingest={{
            rtmp: item.ingest.rtmp,
            srt: item.ingest.srt,
          }}
        />
        <CopyField label="WHIP URL" value={item.ingest.whip.url} />
      </section>

      {token && (
        <section className="border-ink-800 space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">Playback grant</h2>
          <CopyField
            label="Signed HLS URL"
            value={token.signedHlsUrl ?? token.signedVodUrl ?? "(not live yet)"}
          />
          <CopyField label="Token" value={token.token} masked />
          <p className="text-ink-500 text-xs">
            Expires {new Date(token.expiresAt).toLocaleString()}
          </p>
          <div className="bg-ink-950 overflow-hidden rounded-lg">
            <Player
              src={previewSrc}
              live={item.status === "LIVE"}
              playbackToken={token.token}
              placeholder={
                <p className="text-ink-500 p-8 text-center text-sm">
                  {item.status === "LIVE"
                    ? "Waiting for playlist…"
                    : "Publish to go live, then mint a token to preview."}
                </p>
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
