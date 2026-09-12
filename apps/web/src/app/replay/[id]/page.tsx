"use client";

import type { Recording } from "@stream/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Player } from "@/components/player/Player";
import { Alert, Button, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, formatClock, formatDateTime } from "@/lib/format";

type PlaybackResponse = {
  recording: Recording;
  vodUrl: string;
  expiresAt: string;
};

export default function ReplayPage() {
  const params = useParams<{ id: string }>();
  const recordingId = params.id;

  const [data, setData] = useState<PlaybackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The POST is what sets the playback cookie; without it the edge refuses
    // every segment of the replay.
    api
      .post<PlaybackResponse>(`/v1/recordings/${recordingId}/playback`)
      .then(setData)
      .catch((cause: unknown) =>
        setError(errorMessage(cause, "You do not have access to this recording")),
      );
  }, [recordingId]);

  // A long replay outlives its playback cookie; renew it in the background so
  // seeking near the end does not suddenly 401.
  useEffect(() => {
    if (!data) return;
    const msLeft = new Date(data.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        void api
          .post<PlaybackResponse>(`/v1/recordings/${recordingId}/playback`)
          .then(setData)
          .catch(() => undefined);
      },
      Math.max(30_000, msLeft * 0.8),
    );
    return () => clearTimeout(timer);
  }, [data, recordingId]);

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="card w-full max-w-sm space-y-4 p-6 text-center">
          <p className="text-sm">{error}</p>
          <Link href="/library">
            <Button variant="secondary" className="w-full">
              Back to recordings
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  const { recording } = data;

  return (
    <div className="min-h-dvh">
      <header className="border-ink-800 bg-ink-950/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <Link href="/library" className="text-ink-500 hover:text-ink-100 text-sm">
            ← Recordings
          </Link>
          <h1 className="truncate text-sm font-medium">{recording.title}</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
        <Player
          src={data.vodUrl}
          live={false}
          poster={recording.posterUrl}
          autoPlay={false}
        />

        <div className="card flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{recording.title}</p>
            <p className="text-ink-500 mt-0.5 text-xs">
              Recorded {formatDateTime(recording.createdAt)}
              {recording.durationSeconds !== null &&
                ` · ${formatClock(recording.durationSeconds)}`}
              {` · ${formatBytes(recording.sizeBytes)}`}
              {` · ${recording.renditions.join(", ")}`}
            </p>
          </div>

          {recording.downloadUrl && (
            <a href={recording.downloadUrl}>
              <Button variant="secondary" size="sm">
                Download MP4
              </Button>
            </a>
          )}
        </div>

        {recording.status !== "READY" && (
          <Alert tone="info">
            This recording is still processing. Reload in a minute.
          </Alert>
        )}
      </main>
    </div>
  );
}
