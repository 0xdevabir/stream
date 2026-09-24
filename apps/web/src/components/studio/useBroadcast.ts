"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/api";

import { publishWhip, type WhipSession } from "./whip";

export type BroadcastPhase = "idle" | "connecting" | "live" | "reconnecting";

export type BroadcastState = {
  phase: BroadcastPhase;
  /** Seconds since the broadcast first went live, across reconnects. */
  elapsed: number;
  bitrate: number | null;
  /** How many times the connection has been re-established. */
  reconnects: number;
  error: string | null;
};

type IngestGrant = {
  whipUrl: string;
  token: string;
};

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

const IDLE: BroadcastState = {
  phase: "idle",
  elapsed: 0,
  bitrate: null,
  reconnects: 0,
  error: null,
};

/**
 * A broadcast that outlives its PeerConnection.
 *
 * A single WebRTC connection is not durable: ICE consent expires, laptops
 * change networks, NATs drop mappings. Treating that as the end of the class
 * is what made broadcasts stop on their own after a minute or two. So the
 * connection is disposable and the *broadcast* is the thing with a lifetime --
 * when a connection dies we fetch a fresh publish token and dial again,
 * indefinitely, until the instructor actually presses stop.
 *
 * The capture stream is owned by the caller and reused across reconnects, so
 * the camera light never blinks and the browser never re-prompts for
 * permission.
 */
export function useBroadcast(streamId: string) {
  const [state, setState] = useState<BroadcastState>(IDLE);

  const session = useRef<WhipSession | null>(null);
  const media = useRef<MediaStream | null>(null);
  const maxBitrate = useRef(2800);
  const lastBitrate = useRef<number | null>(null);
  const attempt = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number | null>(null);
  /** True whenever no broadcast is wanted, so in-flight retries give up. */
  const stopped = useRef(true);

  // The dial loop is mutually recursive (connect -> reconnect -> connect).
  // Holding it in a ref keeps both halves stable without a dependency cycle.
  const dial = useRef<() => Promise<void>>(async () => {});

  const dropConnection = useCallback(() => {
    const current = session.current;
    session.current = null;
    void current?.close();
  }, []);

  const reconnect = useCallback(() => {
    if (stopped.current || retry.current) return;

    dropConnection();
    attempt.current += 1;

    const ceiling = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** (attempt.current - 1),
    );
    // Full jitter: if the server restarted, every broadcaster is redialling at
    // once and a fixed delay would synchronise them into a thundering herd.
    const delay = Math.random() * ceiling;

    setState((current) => ({
      ...current,
      phase: "reconnecting",
      reconnects: current.reconnects + 1,
    }));

    retry.current = setTimeout(() => {
      retry.current = null;
      void dial.current();
    }, delay);
  }, [dropConnection]);

  /**
   * One dial attempt, with a freshly issued token: publish grants are
   * short-lived by design, so a reconnect an hour into a class cannot reuse
   * the one the page loaded with.
   */
  dial.current = async () => {
    const stream = media.current;
    if (!stream || stopped.current) return;

    try {
      const grant = await api.get<IngestGrant>(`/v1/streams/${streamId}/ingest`);
      if (stopped.current) return;

      const next = await publishWhip(stream, {
        url: grant.whipUrl,
        token: grant.token,
        maxBitrateKbps: maxBitrate.current,
        onState: (connectionState) => {
          if (stopped.current) return;

          if (connectionState === "connected") {
            attempt.current = 0;
            setState((current) => ({ ...current, phase: "live", error: null }));
            return;
          }

          // `disconnected` frequently recovers on its own within a few
          // seconds, so only a terminal state triggers a redial.
          if (connectionState === "failed" || connectionState === "closed") {
            reconnect();
          }
        },
      });

      // The user may have pressed stop while the handshake was in flight.
      if (stopped.current) {
        void next.close();
        return;
      }

      session.current = next;
      startedAt.current ??= Date.now();
      setState((current) => ({ ...current, phase: "live", error: null }));
    } catch (cause) {
      if (stopped.current) return;
      setState((current) => ({
        ...current,
        error: errorMessage(cause, "Could not reach the server"),
      }));
      reconnect();
    }
  };

  const start = useCallback(
    async (stream: MediaStream, maxBitrateKbps: number) => {
      stopped.current = false;
      media.current = stream;
      maxBitrate.current = maxBitrateKbps;
      attempt.current = 0;
      startedAt.current = null;
      lastBitrate.current = null;

      setState({ ...IDLE, phase: "connecting" });
      await dial.current();
    },
    [],
  );

  const stop = useCallback(() => {
    stopped.current = true;
    if (retry.current) {
      clearTimeout(retry.current);
      retry.current = null;
    }
    dropConnection();
    startedAt.current = null;
    setState(IDLE);
  }, [dropConnection]);

  // Clock and upstream bitrate. The clock is anchored to when the broadcast
  // first went live rather than to the current connection, so a reconnect does
  // not make the class look like it restarted.
  useEffect(() => {
    if (state.phase === "idle") return;

    const timer = setInterval(() => {
      void session.current?.bitrate().then((value) => {
        if (value !== null) lastBitrate.current = value;
      });

      setState((current) => ({
        ...current,
        elapsed:
          startedAt.current === null ? 0 : (Date.now() - startedAt.current) / 1000,
        bitrate: lastBitrate.current,
      }));
    }, 1000);

    return () => clearInterval(timer);
  }, [state.phase]);

  // Leaving the page must not strand a publishing connection server-side.
  useEffect(
    () => () => {
      stopped.current = true;
      if (retry.current) clearTimeout(retry.current);
      void session.current?.close();
    },
    [],
  );

  return { ...state, start, stop };
}
