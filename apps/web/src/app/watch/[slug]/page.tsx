"use client";

import type { PlaybackGrant, StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Player, type PlayerStats } from "@/components/player/Player";
import { ChatPanel } from "@/components/room/ChatPanel";
import { useRoom } from "@/components/room/useRoom";
import {
  BackLink,
  Button,
  Field,
  Input,
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

  const status = room.status ?? grant?.status ?? "SCHEDULED";
  const paused = status === "LIVE" && room.paused;

  // hls.js can give up on a playlist that stopped growing during a pause.
  // Remounting the player when media returns is the reliable way back.
  const [playerKey, setPlayerKey] = useState(0);
  const wasPaused = useRef(false);
  useEffect(() => {
    if (wasPaused.current && !paused) setPlayerKey((key) => key + 1);
    wasPaused.current = paused;
  }, [paused]);

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

  const hlsUrl = room.hlsUrl ?? grant?.hlsUrl ?? null;
  const showChat = Boolean(grant?.chatEnabled || grant?.questionsEnabled);
  const title = stream?.title ?? "Class";

  return (
    <div className="animate-page-in min-h-dvh">
      <header className="material sticky top-0 z-20 border-b-[0.5px] border-white/[0.07] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4">
          <BackLink href="/classes">Classes</BackLink>
          <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold max-sm:invisible">{title}</p>
          <div className="flex shrink-0 items-center gap-2">
            {paused ? <PausedBadge /> : <StatusBadge status={status} />}
            {status === "LIVE" && <ViewerPill count={room.viewerCount} />}
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] gap-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 sm:space-y-5">
          <div className="max-sm:[&>div]:rounded-none">
          <Player
            key={playerKey}
            src={status === "ENDED" ? (grant?.vodUrl ?? null) : hlsUrl}
            live={status === "LIVE"}
            whepUrl={status === "LIVE" ? (grant?.whepUrl ?? null) : null}
            whepToken={grant?.whepToken ?? null}
            onQualityChange={onQualityChange}
            placeholder={<Screen status={status} stream={stream} />}
            notice={
              paused ? (
                <ScreenText
                  icon={<PauseIcon />}
                  title="Stream paused"
                  body="It will resume here automatically."
                />
              ) : undefined
            }
          />
          </div>

          <div className="px-4 sm:px-1">
            <h1 className="text-[22px] leading-tight font-bold sm:text-[28px]">{title}</h1>
            {stream?.instructor && (
              <p className="text-ink-500 mt-1 text-sm">{stream.instructor.name}</p>
            )}
            {stream?.description && (
              <p className="text-ink-300 mt-4 max-w-3xl text-sm leading-relaxed whitespace-pre-wrap">
                {stream.description}
              </p>
            )}
          </div>
        </div>

        {showChat && (
          <div className="px-3 sm:px-0 lg:sticky lg:top-24 lg:h-[calc(100dvh-7rem)]">
            <div className="flex h-[min(560px,72dvh)] flex-col lg:h-full">
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

/** What the video surface shows when there is nothing to play. */
function Screen({
  status,
  stream,
}: {
  status: string;
  stream: StreamSummary | null;
}) {
  if (status === "PROCESSING") {
    return <ScreenText title="Class ended" body="The replay will be ready shortly." />;
  }
  if (status === "ENDED") {
    return <ScreenText title="Class ended" />;
  }
  if (status === "CANCELLED") {
    return <ScreenText title="Class cancelled" />;
  }
  return (
    <ScreenText
      title={
        stream?.scheduledAt ? `Starts ${formatDateTime(stream.scheduledAt)}` : "Starting soon"
      }
      body="Plays automatically when it goes live."
    />
  );
}

function ScreenText({
  icon,
  title,
  body,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      {icon}
      <p className="text-[22px] font-bold sm:text-[28px]">{title}</p>
      {body && <p className="text-ink-500 text-sm">{body}</p>}
    </div>
  );
}

function PauseIcon() {
  return (
    <span className="animate-pop-in grid size-16 place-items-center rounded-full bg-white/15 text-white backdrop-blur-xl">
      <svg viewBox="0 0 16 16" className="size-5 fill-current" aria-hidden>
        <path d="M4 3h3v10H4zM9 3h3v10H9z" />
      </svg>
    </span>
  );
}

function PausedBadge() {
  return (
    <span className="bg-warn-500/15 text-warn-500 inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-semibold">
      Paused
    </span>
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
    <main className="animate-page-in grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm space-y-5 p-7">
        {gate.kind === "password" ? (
          <>
            <div>
              <h1 className="text-2xl font-bold">Password required</h1>
              <p className="text-ink-500 mt-1 text-sm">{gate.message}</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
              className="space-y-4"
            >
              <Field label="Password">
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
            <div>
              <h1 className="text-2xl font-bold">Sign in to watch</h1>
              <p className="text-ink-500 mt-1 text-sm">{gate.message}</p>
            </div>
            <Link href={`/login?next=${encodeURIComponent(`/watch/${slug}`)}`} className="block">
              <Button className="w-full">Sign in</Button>
            </Link>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold">No access</h1>
              <p className="text-ink-500 mt-1 text-sm">{gate.message}</p>
            </div>
            <Link href="/classes" className="block">
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
