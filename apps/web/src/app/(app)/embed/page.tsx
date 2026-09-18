"use client";

import type { LiveInput, PlaybackTokenResponse } from "@stream/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/console/layout";
import { Player } from "@/components/player/Player";
import {
  Alert,
  Button,
  CopyField,
  Field,
  Select,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function EmbedPage() {
  const [inputs, setInputs] = useState<LiveInput[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [token, setToken] = useState<PlaybackTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: LiveInput[] }>(
        "/v1/console/live_inputs",
        signal,
      );
      setInputs(data.items);
      if (!selectedId && data.items[0]) setSelectedId(data.items[0].id);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selected = inputs.find((item) => item.id === selectedId) ?? null;

  const snippet = useMemo(() => {
    const url =
      token?.signedHlsUrl ??
      "https://your-cdn.example/hls/<id>/master.m3u8?token=…";
    const tok = token?.token ?? "<playback-jwt>";
    return `<video id="video" controls autoplay playsinline></video>
<script type="module">
  import Hls from "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
  const signedUrl = ${JSON.stringify(url)};
  const token = ${JSON.stringify(tok)};
  const video = document.getElementById("video");
  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      xhrSetup(xhr) {
        xhr.setRequestHeader("Authorization", "Bearer " + token);
      },
    });
    hls.loadSource(signedUrl);
    hls.attachMedia(video);
  } else {
    video.src = signedUrl;
  }
</script>`;
  }, [token]);

  const mint = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await api.post<PlaybackTokenResponse>(
        `/v1/console/live_inputs/${selectedId}/token`,
        { ttlSeconds: 3600 },
      );
      setToken(grant);
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
        eyebrow="Streaming"
        title="Embed & test"
        description="Mint a test token and copy a player snippet for your LMS. Students watch on your domain — not this console."
      />

      {error && <Alert>{error}</Alert>}

      <div className="border-ink-800 flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="min-w-[16rem] flex-1">
          <Field label="Live input">
            <Select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setToken(null);
              }}
            >
              {inputs.length === 0 && <option value="">No live inputs</option>}
              {inputs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.status})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button loading={busy} disabled={!selectedId} onClick={() => void mint()}>
          Mint token
        </Button>
      </div>

      {token && (
        <>
          <CopyField
            label="Signed HLS URL"
            value={token.signedHlsUrl ?? token.signedVodUrl ?? "(waiting for live)"}
          />
          <div>
            <p className="label mb-1">Player snippet</p>
            <pre className="border-ink-800 bg-ink-950 overflow-x-auto rounded-xl border p-4 font-mono text-[11px] leading-relaxed">
              {snippet}
            </pre>
          </div>
          <div className="bg-ink-950 overflow-hidden rounded-xl">
            <Player
              src={
                token.signedHlsUrl ??
                token.signedVodUrl ??
                (selected?.playback.hlsUrl && token.token
                  ? `${selected.playback.hlsUrl}?token=${encodeURIComponent(token.token)}`
                  : null)
              }
              live={selected?.status === "LIVE"}
              playbackToken={token.token}
              placeholder={
                <p className="text-ink-500 p-8 text-center text-sm">
                  Publish the live input, then mint again if the playlist was empty.
                </p>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

