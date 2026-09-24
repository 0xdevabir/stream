"use client";

import type { PlaybackGrant, StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Player, type PlayerStats } from "@/components/player/Player";
import { ChatPanel } from "@/components/room/ChatPanel";
import { useRoom } from "@/components/room/useRoom";
import {
  Alert,
  Button,
  Field,
  Input,
  Section,
  Spinner,
  StatusBadge,
  ViewerPill,
} from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center">
          <Spinner className="text-ink-500 size-6" />
        </div>
      }
    >
      <Watch />
    </Suspense>
  );
}

type Gate =
  | { kind: "loading" }
  | { kind: "granted" }
  | { kind: "password"; message: string }
  | { kind: "signin"; message: string }
  | { kind: "denied"; message: string };

function Watch() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const { user } = useSession();

  const slug = params.slug;
  const shareToken = search.get("t");

  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [grant, setGrant] = useState<PlaybackGrant | null>(null);
  const [stream, setStream] = useState<StreamSummary | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requestGrant = useCallback(
    async (withPassword?: string) => {
      try {
        const result = await api.post<PlaybackGrant>(
          `/v1/streams/${encodeURIComponent(slug)}/playback`,
          {
            ...(withPassword ? { password: withPassword } : {}),
            ...(shareToken ? { shareToken } : {}),
          },
        );
        setGrant(result);
        setGate({ kind: "granted" });
        return result;
      } catch (cause) {
        const code = cause instanceof ApiError ? cause.code : "";
        const message = errorMessage(cause, "You cannot watch this class");

        if (code === "password_required" || code === "invalid_password") {
          setGate({ kind: "password", message });
        } else if (code === "authentication_required") {
          setGate({ kind: "signin", message });
        } else {
          setGate({ kind: "denied", message });
        }
        return null;
      }
    },
    [slug, shareToken],
  );

  useEffect(() => {
    void requestGrant();
  }, [requestGrant]);

  // Public metadata for the header. A failure here is not fatal -- the grant
  // is what actually decides whether the class plays.
  useEffect(() => {
    if (gate.kind !== "granted" || !user) return;
    void api
      .get<{ stream: StreamSummary }>(`/v1/streams/${encodeURIComponent(slug)}`)
      .then((data) => setStream(data.stream))
      .catch(() => undefined);
  }, [gate.kind, slug, user]);

  /**
   * The playback cookie expires while long classes are still running. Renew
   * it well before then, otherwise the first segment after expiry 401s and
   * hls.js tears the whole session down.
   */
  useEffect(() => {
    if (!grant) return;
    const msLeft = new Date(grant.expiresAt).getTime() - Date.now();
    const renewIn = Math.max(30_000, msLeft * 0.8);
    const timer = setTimeout(() => void requestGrant(password || undefined), renewIn);
    return () => clearTimeout(timer);
  }, [grant, requestGrant, password]);

  // Best-effort release so the viewer count drops immediately rather than
  // waiting for the session to time out.
  useEffect(() => {
    if (gate.kind !== "granted") return;
    const release = () => {
      navigator.sendBeacon?.(
        `/v1/streams/${encodeURIComponent(slug)}/playback/end`,
        new Blob([], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [gate.kind, slug]);

  const streamId = grant?.streamId ?? null;
  const room = useRoom(streamId, { enabled: gate.kind === "granted" });

  // The socket announces the transition to LIVE; that is the cue to fetch a
  // grant that actually carries an HLS URL.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!room.status || room.status === lastStatus.current) return;
    const previous = lastStatus.current;
    lastStatus.current = room.status;
    if (previous && room.status !== previous) void requestGrant(password || undefined);
  }, [room.status, requestGrant, password]);

  const onQualityChange = useCallback(
    (stats: PlayerStats) => {
      if (!stats.rendition || stats.mode !== "hls") return;
      room.reportQuality(
        stats.rendition,
        stats.droppedFrames,
        Math.round(stats.bufferSeconds),
      );
    },
    [room],
  );

  if (gate.kind === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  if (gate.kind !== "granted") {
    return (
      <Gatekeeper
        gate={gate}
        password={password}
        setPassword={setPassword}
        submitting={submitting}
        onSubmit={async () => {
          setSubmitting(true);
          await requestGrant(password);
          setSubmitting(false);
        }}
        slug={slug}
      />
    );
  }

  const status = room.status ?? grant?.status ?? "SCHEDULED";
  const hlsUrl = room.hlsUrl ?? grant?.hlsUrl ?? null;
  const showChat = Boolean(grant?.chatEnabled || grant?.questionsEnabled);

  return (
    <div className="min-h-dvh">
      <header className="border-ink-800 bg-ink-950/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-3">
          <Link href="/classes" className="text-ink-500 hover:text-ink-100 text-sm">
            ← Classes
          </Link>
          <h1 className="truncate text-sm font-medium">
            {stream?.title ?? "Class"}
          </h1>
          <StatusBadge status={status} />
          {status === "LIVE" && <ViewerPill count={room.viewerCount} />}
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Player
            src={status === "ENDED" ? (grant?.vodUrl ?? null) : hlsUrl}
            live={status === "LIVE"}
            whepUrl={status === "LIVE" ? (grant?.whepUrl ?? null) : null}
            whepToken={grant?.whepToken ?? null}
            onQualityChange={onQualityChange}
            placeholder={<PreLive status={status} stream={stream} />}
          />

          <Section>
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">{stream?.title ?? "Class"}</h2>
                {stream?.instructor && (
                  <p className="text-ink-500 mt-0.5 text-sm">
                    with {stream.instructor.name}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={status} />
                {status === "LIVE" && <ViewerPill count={room.viewerCount} />}
              </div>
            </div>
            {stream?.description && (
              <p className="text-ink-300 border-ink-800 mt-4 border-t pt-4 text-sm whitespace-pre-wrap">
                {stream.description}
              </p>
            )}
          </Section>

          {status === "ENDED" && grant?.vodUrl === null && (
            <Alert tone="info">
              This class has ended. The replay is still being processed and will
              appear in your recordings shortly.
            </Alert>
          )}
        </div>

        {showChat && (
          <div className="lg:h-[calc(100dvh-7rem)] lg:sticky lg:top-20">
            <div className="flex h-[500px] flex-col lg:h-full">
              <ChatPanel
                room={room}
                chatEnabled={grant?.chatEnabled ?? false}
                questionsEnabled={grant?.questionsEnabled ?? false}
                canPost={Boolean(user)}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PreLive({
  status,
  stream,
}: {
  status: string;
  stream: StreamSummary | null;
}) {
  if (status === "PROCESSING") {
    return (
      <div className="space-y-2">
        <p className="text-sm">The class has ended.</p>
        <p className="text-ink-500 text-xs">
          The replay is being prepared — this usually takes under a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {stream?.scheduledAt
          ? `Starts ${formatDateTime(stream.scheduledAt)}`
          : "This class has not started yet."}
      </p>
      <p className="text-ink-500 text-xs">
        This page will start playing on its own when the instructor goes live.
      </p>
    </div>
  );
}

function Gatekeeper({
  gate,
  password,
  setPassword,
  submitting,
  onSubmit,
  slug,
}: {
  gate: Exclude<Gate, { kind: "loading" } | { kind: "granted" }>;
  password: string;
  setPassword: (value: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  slug: string;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm space-y-4 p-6">
        {gate.kind === "password" ? (
          <>
            <div>
              <h1 className="text-base font-medium">This class is protected</h1>
              <p className="text-ink-500 mt-1 text-sm">{gate.message}</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
              className="space-y-3"
            >
              <Field label="Class password">
                <Input
                  type="password"
                  autoFocus
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button type="submit" loading={submitting} className="w-full">
                Watch
              </Button>
            </form>
          </>
        ) : gate.kind === "signin" ? (
          <>
            <h1 className="text-base font-medium">Sign in to watch</h1>
            <p className="text-ink-500 text-sm">{gate.message}</p>
            <Link href={`/login?next=${encodeURIComponent(`/watch/${slug}`)}`}>
              <Button className="w-full">Sign in</Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-base font-medium">No access</h1>
            <p className="text-ink-500 text-sm">{gate.message}</p>
            <Link href="/classes">
              <Button variant="secondary" className="w-full">
                Back to classes
              </Button>
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
