"use client";

import type { Recording } from "@stream/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Player } from "@/components/player/Player";
import { Alert, BackLink, Button, Spinner } from "@/components/ui";
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
    <div className="animate-page-in min-h-dvh">
      <header className="material sticky top-0 z-20 border-b-[0.5px] border-white/[0.07] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <BackLink href="/library">Recordings</BackLink>
          <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold max-sm:invisible">{recording.title}</p>
          <span aria-hidden className="shrink-0 sm:w-[100px]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4 max-sm:[&>div:first-child]:rounded-none">
        <Player
          src={data.vodUrl}
          live={false}
          poster={recording.posterUrl}
          autoPlay={false}
        />

        {recording.status !== "READY" && (
          <div className="px-3 sm:px-0">
            <Alert tone="info">Still processing. Reload in a minute.</Alert>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4 px-4 sm:px-1">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] leading-tight font-bold sm:text-[28px]">{recording.title}</h1>
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
