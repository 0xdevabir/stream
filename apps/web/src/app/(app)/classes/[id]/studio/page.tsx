"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  IngestPanel,
  ShareLinkPanel,
  type IngestCredentials,
} from "@/components/IngestPanel";
import { ChatPanel } from "@/components/room/ChatPanel";
import { useRoom } from "@/components/room/useRoom";
import { HealthPanel } from "@/components/studio/HealthPanel";
import { PreviewStage } from "@/components/studio/PreviewStage";
import {
  CAPTURE_HEIGHTS,
  SourcePanel,
  type CaptureSettings,
} from "@/components/studio/SourcePanel";
import { useBroadcast } from "@/components/studio/useBroadcast";
import { capture, listDevices, type DeviceList } from "@/components/studio/whip";
import { Alert, BackLink, Button, Section, Spinner, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { classNames } from "@/lib/format";

type IngestInfo = IngestCredentials & { ladder: string[] };

export default function StudioPage() {
  const { id: streamId } = useParams<{ id: string }>();

  const previewRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<MediaStream | null>(null);

  const [stream, setStream] = useState<StreamSummary | null>(null);
  const [ingest, setIngest] = useState<IngestInfo | null>(null);
  const [devices, setDevices] = useState<DeviceList>({ cameras: [], microphones: [] });
  const [settings, setSettings] = useState<CaptureSettings>({
    source: "camera",
    cameraId: "",
    microphoneId: "",
    height: 720,
  });
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [ending, setEnding] = useState(false);

  const room = useRoom(streamId);
  const broadcast = useBroadcast(streamId);
  const onAir = broadcast.phase !== "idle";

  // ── Data ─────────────────────────────────────────────────────────────────

  const loadStream = useCallback(async () => {
    const { stream: row } = await api.get<{ stream: StreamSummary }>(
      `/v1/streams/${streamId}`,
    );
    setStream(row);
  }, [streamId]);

  useEffect(() => {
    void (async () => {
      try {
        const [, credentials] = await Promise.all([
          loadStream(),
          api.get<IngestInfo>(`/v1/streams/${streamId}/ingest`),
        ]);
        setIngest(credentials);
      } catch (cause) {
        setError(errorMessage(cause, "Could not load this class"));
      }
    })();
  }, [streamId, loadStream]);

  // The header should reflect the server's view of the class, not just what
  // this tab believes -- an OBS publisher can take it live from elsewhere.
  useEffect(() => {
    const timer = setInterval(() => void loadStream().catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [loadStream]);

  // ── Capture ──────────────────────────────────────────────────────────────

  const stopPreview = useCallback(() => {
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setPreviewing(false);
  }, []);

  const startPreview = useCallback(async () => {
    setError(null);
    try {
      stopPreview();
      const media = await capture({
        source: settings.source,
        height: settings.height,
        ...(settings.cameraId ? { cameraId: settings.cameraId } : {}),
        ...(settings.microphoneId ? { microphoneId: settings.microphoneId } : {}),
      });

      // Ending a screen share from the browser's own "Stop sharing" bar should
      // not leave a frozen frame on air.
      media.getVideoTracks()[0]?.addEventListener("ended", () => {
        broadcast.stop();
        stopPreview();
      });

      mediaRef.current = media;
      if (previewRef.current) previewRef.current.srcObject = media;
      setPreviewing(true);
      // Device labels only become readable once a permission is granted.
      setDevices(await listDevices());
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "Could not access your camera or screen. Check the browser's permission prompt.",
        ),
      );
    }
  }, [settings, stopPreview, broadcast]);

  // ── Broadcast ────────────────────────────────────────────────────────────

  const goLive = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) {
      setError("Start the preview first so you can see what you are about to send.");
      return;
    }
    setError(null);
    const kbps =
      CAPTURE_HEIGHTS.find((option) => option.value === settings.height)?.kbps ?? 2800;
    await broadcast.start(media, kbps);
  }, [broadcast, settings.height]);

  const endClass = useCallback(async () => {
    setEnding(true);
    broadcast.stop();
    stopPreview();
    try {
      // Disconnects any publisher -- this tab or an OBS instance -- and lets
      // the transcoder finalize the recording straight away.
      await api.post(`/v1/streams/${streamId}/end`);
      await loadStream();
    } catch (cause) {
      setError(errorMessage(cause, "Could not end the class"));
    } finally {
      setEnding(false);
    }
  }, [broadcast, stopPreview, streamId, loadStream]);

  const rotateKey = async () => {
    setRotating(true);
    try {
      const data = await api.post<{ ingest: IngestCredentials }>(
        `/v1/streams/${streamId}/key/rotate`,
      );
      setIngest((current) => (current ? { ...current, ...data.ingest } : current));
    } catch (cause) {
      setError(errorMessage(cause, "Could not rotate the stream key"));
    } finally {
      setRotating(false);
    }
  };

  // Closing the tab mid-class should warn rather than silently drop the feed.
  useEffect(() => {
    if (!onAir) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [onAir]);

  useEffect(() => () => mediaRef.current?.getTracks().forEach((t) => t.stop()), []);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!stream || !ingest) {
    return (
      <div className="grid place-items-center py-24">
        {error ? <Alert>{error}</Alert> : <Spinner className="text-ink-500 size-6" />}
      </div>
    );
  }

  const serverLive = stream.status === "LIVE";

  return (
    <div className="space-y-5">
      <StudioHeader
        stream={stream}
        streamId={streamId}
        canEnd={onAir || serverLive}
        ending={ending}
        onEnd={() => void endClass()}
      />

      {(error ?? broadcast.error) && broadcast.phase !== "reconnecting" && (
        <Alert>{error ?? broadcast.error}</Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <PreviewStage
            videoRef={previewRef}
            previewing={previewing}
            phase={broadcast.phase}
            elapsed={broadcast.elapsed}
            bitrate={broadcast.bitrate}
            reconnects={broadcast.reconnects}
          />

          <GoLiveBar
            phase={broadcast.phase}
            previewing={previewing}
            onGoLive={() => void goLive()}
            onStop={() => broadcast.stop()}
          />

          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Source">
              <SourcePanel
                settings={settings}
                onChange={setSettings}
                devices={devices}
                locked={onAir}
                previewing={previewing}
                onStartPreview={() => void startPreview()}
                onStopPreview={stopPreview}
              />
            </Section>

            <Section title="Health">
              <HealthPanel
                phase={broadcast.phase}
                elapsed={broadcast.elapsed}
                bitrate={broadcast.bitrate}
                reconnects={broadcast.reconnects}
                viewers={room.viewerCount}
                renditions={ingest.ladder}
              />
            </Section>
          </div>

          <Section title="Share">
            <ShareLinkPanel
              slug={stream.slug}
              shareToken={null}
              accessMode={stream.accessMode}
            />
          </Section>

          <Section
            title="Stream from OBS"
          >
            <IngestPanel
              ingest={{ rtmp: ingest.rtmp, srt: ingest.srt }}
              onRotate={() => void rotateKey()}
              rotating={rotating}
            />
          </Section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex h-[560px] flex-col lg:h-[calc(100dvh-7rem)]">
            <ChatPanel
              room={room}
              chatEnabled={stream.chatEnabled}
              questionsEnabled={stream.questionsEnabled}
              canPost
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Page sections ──────────────────────────────────────────────────────────

function StudioHeader({
  stream,
  streamId,
  canEnd,
  ending,
  onEnd,
}: {
  stream: StreamSummary;
  streamId: string;
  canEnd: boolean;
  ending: boolean;
  onEnd: () => void;
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        <BackLink href="/classes">Classes</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="page-title truncate">{stream.title}</h1>
          <StatusBadge status={stream.status} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href={`/watch/${stream.slug}`} target="_blank">
          <Button variant="ghost" size="sm">
            Student view
          </Button>
        </Link>
        <Link href={`/classes/${streamId}/manage`}>
          <Button variant="secondary" size="sm">
            Settings
          </Button>
        </Link>
        {canEnd && (
          <Button variant="danger" size="sm" loading={ending} onClick={onEnd}>
            End class
          </Button>
        )}
      </div>
    </header>
  );
}

/**
 * The one decision on this page, given its own row so it is never hunted for.
 * "Pause" pauses the feed but keeps the class open; "End class" in
 * the header is the irreversible one that publishes the recording.
 */
function GoLiveBar({
  phase,
  previewing,
  onGoLive,
  onStop,
}: {
  phase: ReturnType<typeof useBroadcast>["phase"];
  previewing: boolean;
  onGoLive: () => void;
  onStop: () => void;
}) {
  const onAir = phase !== "idle";

  return (
    <div className="card flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className={classNames(
            "size-2.5 shrink-0 rounded-full transition-colors duration-500",
            phase === "live" && "bg-live-500 live-dot",
            (phase === "connecting" || phase === "reconnecting") && "bg-warn-500 animate-pulse",
            phase === "idle" && (previewing ? "bg-ok-500" : "bg-ink-700"),
          )}
        />
        <p className="text-[17px] font-semibold">
          {phase === "idle" && (previewing ? "Ready" : "Start a preview to go live")}
          {phase === "connecting" && "Connecting…"}
          {phase === "live" && "You are live"}
          {phase === "reconnecting" && "Reconnecting…"}
        </p>
      </div>

      {onAir ? (
        <Button variant="secondary" onClick={onStop}>
          Pause
        </Button>
      ) : (
        <Button
          variant="live"
          size="lg"
          disabled={!previewing}
          onClick={onGoLive}
          className="min-w-32"
        >
          Go live
        </Button>
      )}
    </div>
  );
}
