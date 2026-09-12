"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatPanel } from "@/components/room/ChatPanel";
import { useRoom } from "@/components/room/useRoom";
import { IngestPanel, ShareLinkPanel, type IngestCredentials } from "@/components/IngestPanel";
import {
  capture,
  listDevices,
  publishWhip,
  type DeviceList,
  type WhipSession,
} from "@/components/studio/whip";
import {
  Alert,
  Button,
  Field,
  Select,
  Spinner,
  StatusBadge,
  ViewerPill,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { classNames, formatBitrate, formatClock } from "@/lib/format";

type IngestGrant = IngestCredentials & {
  streamId: string;
  whipUrl: string;
  token: string;
  expiresAt: string;
  ladder: string[];
};

const CAPTURE_HEIGHTS = [
  { value: 1080, label: "1080p", kbps: 4500 },
  { value: 720, label: "720p", kbps: 2800 },
  { value: 480, label: "480p", kbps: 1400 },
];

export default function StudioPage() {
  const params = useParams<{ id: string }>();
  const streamId = params.id;

  const previewRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<WhipSession | null>(null);

  const [stream, setStream] = useState<StreamSummary | null>(null);
  const [ingest, setIngest] = useState<IngestGrant | null>(null);
  const [devices, setDevices] = useState<DeviceList>({ cameras: [], microphones: [] });
  const [source, setSource] = useState<"camera" | "screen">("camera");
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [height, setHeight] = useState(720);

  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [bitrate, setBitrate] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const room = useRoom(streamId);

  const load = useCallback(async () => {
    try {
      const [detail, credentials] = await Promise.all([
        api.get<{ stream: StreamSummary }>(`/v1/streams/${streamId}`),
        api.get<IngestGrant>(`/v1/streams/${streamId}/ingest`),
      ]);
      setStream(detail.stream);
      setIngest(credentials);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load this class"));
    }
  }, [streamId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the class row while live so the header reflects the server's view of
  // the status rather than only what this tab believes.
  useEffect(() => {
    const timer = setInterval(() => {
      void api
        .get<{ stream: StreamSummary }>(`/v1/streams/${streamId}`)
        .then((data) => setStream(data.stream))
        .catch(() => undefined);
    }, 10_000);
    return () => clearInterval(timer);
  }, [streamId]);

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
        source,
        ...(cameraId ? { cameraId } : {}),
        ...(microphoneId ? { microphoneId } : {}),
        height,
      });
      mediaRef.current = media;
      if (previewRef.current) previewRef.current.srcObject = media;
      setPreviewing(true);
      // Labels only become readable once a permission has been granted.
      setDevices(await listDevices());
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "Could not access your camera or screen. Check the browser's permission prompt.",
        ),
      );
    }
  }, [source, cameraId, microphoneId, height, stopPreview]);

  const goLive = useCallback(async () => {
    if (!ingest) return;
    const media = mediaRef.current;
    if (!media) {
      setError("Start the preview first so you can see what you are about to send.");
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      const kbps =
        CAPTURE_HEIGHTS.find((option) => option.value === height)?.kbps ?? 2800;

      sessionRef.current = await publishWhip(media, {
        url: ingest.whipUrl,
        token: ingest.token,
        maxBitrateKbps: kbps,
        onState: (state) => {
          if (state === "failed" || state === "disconnected") {
            setError("The connection to the server dropped.");
            setPublishing(false);
          }
        },
      });
      setPublishing(true);
    } catch (cause) {
      setError(errorMessage(cause, "Could not start the broadcast"));
    } finally {
      setConnecting(false);
    }
  }, [ingest, height]);

  const endClass = useCallback(async () => {
    await sessionRef.current?.close();
    sessionRef.current = null;
    setPublishing(false);
    stopPreview();

    try {
      // Disconnects any publisher -- this tab's WHIP session or an OBS
      // instance -- and lets the transcoder drive PROCESSING -> ENDED.
      await api.post(`/v1/streams/${streamId}/end`);
    } catch (cause) {
      setError(errorMessage(cause, "Could not end the class"));
    }
    void load();
  }, [streamId, stopPreview, load]);

  // Upstream bitrate and a running clock, so the instructor can see at a
  // glance that video is actually leaving the machine.
  useEffect(() => {
    if (!publishing) {
      setElapsed(0);
      setBitrate(null);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
      void sessionRef.current?.bitrate().then((value) => {
        if (value !== null) setBitrate(value);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [publishing]);

  // Leaving the page must not leave a camera light on or a half-open session.
  useEffect(
    () => () => {
      void sessionRef.current?.close();
      mediaRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

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

  const status = stream?.status ?? "SCHEDULED";
  const isLive = status === "LIVE";

  if (!stream || !ingest) {
    return (
      <div className="grid place-items-center py-24">
        {error ? <Alert>{error}</Alert> : <Spinner className="text-ink-500 size-6" />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/classes" className="text-ink-500 hover:text-ink-100 text-sm">
          ← Classes
        </Link>
        <h1 className="text-lg font-semibold">{stream.title}</h1>
        <StatusBadge status={status} />
        {isLive && <ViewerPill count={room.viewerCount} />}

        <div className="ml-auto flex items-center gap-2">
          <Link href={`/classes/${streamId}/manage`}>
            <Button variant="ghost" size="sm">
              Settings
            </Button>
          </Link>
          {(isLive || publishing) && (
            <Button variant="danger" onClick={() => void endClass()}>
              End class
            </Button>
          )}
        </div>
      </header>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="bg-ink-950 relative aspect-video overflow-hidden rounded-xl border border-ink-800">
            <video
              ref={previewRef}
              autoPlay
              playsInline
              // Monitoring your own microphone through the speakers is an
              // instant feedback loop; the preview is always silent.
              muted
              className="size-full bg-black object-contain"
            />

            {!previewing && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <p className="text-ink-300 text-sm">No preview yet</p>
                  <p className="text-ink-500 mt-1 text-xs">
                    Pick a source below, then start the preview.
                  </p>
                </div>
              </div>
            )}

            {publishing && (
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold">
                <span className="live-dot bg-live-500 size-2 rounded-full" />
                LIVE {formatClock(elapsed)}
                {bitrate !== null && (
                  <span className="text-ink-300 font-normal">
                    · {formatBitrate(bitrate)} up
                  </span>
                )}
              </div>
            )}
          </div>

          <section className="card space-y-4 p-4">
            <div className="flex gap-2">
              {(["camera", "screen"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={publishing}
                  onClick={() => setSource(option)}
                  className={classNames(
                    "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50",
                    source === option
                      ? "border-brand-500 bg-brand-500/10 text-ink-100"
                      : "border-ink-800 text-ink-500 hover:text-ink-300",
                  )}
                >
                  {option === "camera" ? "Camera + mic" : "Screen share"}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {source === "camera" && (
                <Field label="Camera">
                  <Select
                    value={cameraId}
                    disabled={publishing}
                    onChange={(event) => setCameraId(event.target.value)}
                  >
                    <option value="">Default</option>
                    {devices.cameras.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || "Camera"}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label="Microphone">
                <Select
                  value={microphoneId}
                  disabled={publishing}
                  onChange={(event) => setMicrophoneId(event.target.value)}
                >
                  <option value="">Default</option>
                  {devices.microphones.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Microphone"}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Send quality"
                hint="Students still get every rung of the ladder."
              >
                <Select
                  value={height}
                  disabled={publishing}
                  onChange={(event) => setHeight(Number(event.target.value))}
                >
                  {CAPTURE_HEIGHTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.kbps / 1000} Mbps
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void startPreview()}
                disabled={publishing}
              >
                {previewing ? "Restart preview" : "Start preview"}
              </Button>

              {!publishing ? (
                <Button
                  variant="live"
                  size="lg"
                  loading={connecting}
                  disabled={!previewing}
                  onClick={() => void goLive()}
                >
                  Go live
                </Button>
              ) : (
                <Button variant="danger" size="lg" onClick={() => void endClass()}>
                  Stop broadcasting
                </Button>
              )}

              {previewing && !publishing && (
                <Button variant="ghost" onClick={stopPreview}>
                  Stop preview
                </Button>
              )}
            </div>

            <p className="text-ink-500 text-xs">
              Renditions students will receive: {ingest.ladder.join(", ")}. The
              server builds these from whatever you send, so sending 720p just
              means 1080p is not offered.
            </p>
          </section>

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Broadcast from OBS instead
            </summary>
            <div className="space-y-5 pt-4">
              <IngestPanel
                ingest={{ rtmp: ingest.rtmp, srt: ingest.srt }}
                onRotate={() => void rotateKey()}
                rotating={rotating}
              />
              <ShareLinkPanel
                slug={stream.slug}
                shareToken={null}
                accessMode={stream.accessMode}
              />
            </div>
          </details>
        </div>

        <div className="flex h-[600px] flex-col lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]">
          <ChatPanel
            room={room}
            chatEnabled={stream.chatEnabled}
            questionsEnabled={stream.questionsEnabled}
            canPost
          />
        </div>
      </div>
    </div>
  );
}
