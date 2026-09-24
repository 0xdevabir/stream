"use client";

import type { PlaybackGrant, PlaybackStatus } from "@stream/shared";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Player } from "@/components/player/Player";
import { Spinner } from "@/components/ui";

/**
 * The embeddable player: what a customer puts in an iframe on their own site.
 *
 *   <iframe src="https://<host>/embed/<slug>?token=<embed token>"
 *           allow="autoplay; fullscreen; picture-in-picture" allowfullscreen>
 *
 * The embed token (minted by the customer's backend with an API key) replaces
 * every access check. It is exchanged once for a playback token, which then
 * travels as an X-Playback-Token header rather than a cookie: in a third-party
 * iframe, browsers drop our cookies. No chat and no WebSocket -- status is
 * polled, which is cheap and needs no session.
 */
export default function EmbedPage() {
  return (
    <Suspense fallback={<Centered><Spinner className="text-ink-500 size-6" /></Centered>}>
      <Embed />
    </Suspense>
  );
}

const POLL_WAITING_MS = 5_000;
const POLL_LIVE_MS = 15_000;

class EmbedError extends Error {}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; token?: string | null },
): Promise<T> {
  const response = await fetch(path, {
    method: init.method,
    // Never ride on a first-party session the viewer might also have: an
    // embed is authorized by its token alone.
    credentials: "omit",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { "X-Playback-Token": init.token } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    throw new EmbedError(data?.error?.message ?? "This class is not available");
  }
  return data as T;
}

function Embed() {
  const { slug } = useParams<{ slug: string }>();
  const embedToken = useSearchParams().get("token");
  const base = `/v1/streams/${encodeURIComponent(slug)}`;

  const [grant, setGrant] = useState<PlaybackGrant | null>(null);
  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The current playback token, readable from timers without re-arming them.
  const tokenRef = useRef<string | null>(null);

  const applyGrant = useCallback((next: PlaybackGrant) => {
    tokenRef.current = next.playbackToken ?? null;
    setGrant(next);
    setStatus({
      streamId: next.streamId,
      status: next.status,
      hlsUrl: next.hlsUrl,
      vodUrl: next.vodUrl,
    });
  }, []);

  // First grant, from the embed token.
  useEffect(() => {
    if (!embedToken) {
      setError("This embed is missing its access token");
      return;
    }
    call<PlaybackGrant>(`${base}/playback`, { method: "POST", body: { embedToken } })
      .then(applyGrant)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [base, embedToken, applyGrant]);

  // Renewal, by presenting the current playback token. Independent of the
  // embed token, so a class can run longer than the token that opened it.
  useEffect(() => {
    if (!grant) return;
    const msLeft = new Date(grant.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => {
      call<PlaybackGrant>(`${base}/playback`, {
        method: "POST",
        body: {},
        token: tokenRef.current,
      })
        .then(applyGrant)
        .catch(() => setError("Your viewing session has ended. Reload to continue."));
    }, Math.max(30_000, msLeft * 0.8));
    return () => clearTimeout(timer);
  }, [grant, base, applyGrant]);

  // Status poll: notices a class starting, ending, and its replay appearing.
  const current = status?.status;
  const settled = current === "ENDED" && Boolean(status?.vodUrl);
  useEffect(() => {
    if (!grant || settled || current === "CANCELLED") return;
    const interval = current === "LIVE" ? POLL_LIVE_MS : POLL_WAITING_MS;
    const timer = setInterval(() => {
      call<PlaybackStatus>(`${base}/playback/status`, {
        method: "GET",
        token: tokenRef.current,
      })
        .then((next) =>
          setStatus((previous) =>
            previous &&
            previous.status === next.status &&
            previous.hlsUrl === next.hlsUrl &&
            previous.vodUrl === next.vodUrl
              ? previous
              : next,
          ),
        )
        .catch(() => undefined);
    }, interval);
    return () => clearInterval(timer);
  }, [grant, base, current, settled]);

  // Best-effort release so the viewer count drops immediately.
  useEffect(() => {
    const release = () => {
      const token = tokenRef.current;
      if (!token) return;
      void fetch(`${base}/playback/end`, {
        method: "POST",
        credentials: "omit",
        keepalive: true,
        headers: { "X-Playback-Token": token },
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [base]);

  if (error) {
    return (
      <Centered>
        <p className="text-ink-300 max-w-sm px-4 text-center text-sm">{error}</p>
      </Centered>
    );
  }

  if (!grant || !status) {
    return (
      <Centered>
        <Spinner className="text-ink-500 size-6" />
      </Centered>
    );
  }

  const src = status.status === "ENDED" ? status.vodUrl : status.hlsUrl;

  return (
    <main className="bg-black">
      <Player
        src={src}
        live={status.status === "LIVE"}
        whepUrl={status.status === "LIVE" ? grant.whepUrl : null}
        whepToken={grant.whepToken}
        playbackToken={grant.playbackToken ?? null}
        placeholder={<Waiting status={status.status} />}
      />
    </main>
  );
}

function Waiting({ status }: { status: PlaybackStatus["status"] }) {
  const text =
    status === "PROCESSING" || status === "ENDED"
      ? "The class has ended. The replay will appear here shortly."
      : status === "CANCELLED"
        ? "This class was cancelled."
        : "This class has not started yet. It will play here on its own.";
  return <p className="text-sm">{text}</p>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-black">{children}</div>;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "This class is not available";
}
