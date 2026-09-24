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
      <header className="sticky top-0 z-20 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="bg-ink-900/70 border-ink-800/80 mx-auto flex h-14 w-full max-w-5xl items-center gap-3 rounded-full border px-2.5 backdrop-blur-md sm:px-3">
          <Link
            href="/library"
            aria-label="Back to recordings"
            className="bg-ink-800 hover:bg-ink-700 grid size-9 shrink-0 place-items-center rounded-full transition-colors"
          >
            <svg viewBox="0 0 16 16" className="size-4 fill-current" aria-hidden>
              <path d="M10.3 3.3a1 1 0 0 1 0 1.4L7 8l3.3 3.3a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0Z" />
            </svg>
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm font-black">{recording.title}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-5 px-3 py-4 sm:px-4">
        <Player
          src={data.vodUrl}
          live={false}
          poster={recording.posterUrl}
          autoPlay={false}
        />

        {recording.status !== "READY" && (
          <Alert tone="info">Still processing. Reload in a minute.</Alert>
        )}

        <div className="flex flex-wrap items-end gap-4 px-1">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-black sm:text-3xl">{recording.title}</h1>
            <p className="text-ink-500 mt-1 text-sm">
              {formatDateTime(recording.createdAt)}
              {recording.durationSeconds !== null &&
                ` · ${formatClock(recording.durationSeconds)}`}
              {` · ${formatBytes(recording.sizeBytes)}`}
            </p>
          </div>

          {recording.downloadUrl && (
            <a href={recording.downloadUrl}>
              <Button variant="secondary">Download</Button>
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
