"use client";

import {
  PRESENCE_HEARTBEAT_MS,
  serverMessageSchema,
  type ChatMessage,
  type ClientMessage,
  type ServerMessage,
} from "@stream/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type RoomStatus =
  | "SCHEDULED"
  | "LIVE"
  | "PROCESSING"
  | "ENDED"
  | "CANCELLED";

export type RoomState = {
  connected: boolean;
  /** Null until the socket delivers its first `hello`. */
  canModerate: boolean;
  viewerCount: number;
  slowModeSeconds: number;
  messages: ChatMessage[];
  /** Stream status pushed by the server; drives the pre-live / ended screens. */
  status: RoomStatus | null;
  hlsUrl: string | null;
  error: string | null;
};

export type RoomActions = {
  send: (message: ClientMessage) => void;
  post: (body: string, kind: "CHAT" | "QUESTION") => void;
  vote: (messageId: string, up: boolean) => void;
  moderate: (
    messageId: string,
    action: "delete" | "pin" | "unpin" | "answer" | "unanswer",
  ) => void;
  setSlowMode: (seconds: number) => void;
  reportQuality: (rendition: string, droppedFrames: number, bufferSeconds: number) => void;
};

const MAX_MESSAGES = 400;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 20_000;

/**
 * One socket per class room, carrying chat, Q&A, presence and status.
 *
 * Reconnects with exponential backoff and full jitter -- when an API instance
 * restarts, every viewer in the class is disconnected at once, and a fixed
 * delay would bring them all back in the same instant.
 */
export function useRoom(
  streamId: string | null,
  options: { enabled?: boolean } = {},
): RoomState & RoomActions {
  const enabled = options.enabled ?? true;

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUs = useRef(false);

  const [connected, setConnected] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    if (!streamId || !enabled) return;

    closedByUs.current = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${scheme}//${window.location.host}/ws/stream/${encodeURIComponent(streamId)}`,
      );
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        setConnected(true);
        setError(null);

        // Doubles as presence: the server extends this connection's TTL in the
        // room's sorted set on every ping.
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
          }
        }, PRESENCE_HEARTBEAT_MS);
      });

      socket.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }

        const result = serverMessageSchema.safeParse(parsed);
        if (!result.success) return;
        apply(result.data);
      });

      socket.addEventListener("close", (event) => {
        setConnected(false);
        if (heartbeat) clearInterval(heartbeat);
        if (closedByUs.current) return;

        // 4001 is our own "you may not be here" close; retrying would just
        // hammer the API with a request that can never succeed.
        if (event.code === 4001) {
          setError("You do not have access to this room");
          return;
        }

        attemptRef.current += 1;
        const ceiling = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * 2 ** (attemptRef.current - 1),
        );
        retry = setTimeout(connect, Math.random() * ceiling);
      });

      socket.addEventListener("error", () => setConnected(false));
    };

    const apply = (message: ServerMessage) => {
      switch (message.t) {
        case "hello":
          setViewerCount(message.viewerCount);
          setCanModerate(message.canModerate);
          setSlowModeSeconds(message.slowModeSeconds);
          setMessages(message.backlog);
          return;

        case "pong":
          return;

        case "message":
          setMessages((current) =>
            // The server echoes our own message back; replacing by id keeps
            // a reconnect-driven duplicate from showing twice.
            appendMessage(current, message.message),
          );
          return;

        case "message_update":
          setMessages((current) =>
            current.map((existing) =>
              existing.id === message.message.id ? message.message : existing,
            ),
          );
          return;

        case "message_delete":
          setMessages((current) =>
            current.filter((existing) => existing.id !== message.id),
          );
          return;

        case "viewers":
          setViewerCount(message.count);
          return;

        case "status":
          setStatus(message.status);
          setHlsUrl(message.hlsUrl);
          return;

        case "slowmode":
          setSlowModeSeconds(message.seconds);
          return;

        case "error":
          setError(message.message);
          return;
      }
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (heartbeat) clearInterval(heartbeat);
      if (retry) clearTimeout(retry);
      socketRef.current?.close(1000, "navigating away");
      socketRef.current = null;
      setConnected(false);
    };
  }, [streamId, enabled]);

  const actions = useMemo<RoomActions>(
    () => ({
      send,
      post: (body, kind) =>
        send({
          t: "chat",
          body,
          kind,
          // Lets the sender match the server's echo to its own optimistic row.
          nonce: crypto.randomUUID(),
        }),
      vote: (messageId, up) => send({ t: up ? "upvote" : "unvote", messageId }),
      moderate: (messageId, action) => send({ t: "moderate", action, messageId }),
      setSlowMode: (seconds) => send({ t: "slowmode", seconds }),
      reportQuality: (rendition, droppedFrames, bufferSeconds) =>
        send({
          t: "quality",
          rendition: rendition as never,
          droppedFrames,
          bufferSeconds,
        }),
    }),
    [send],
  );

  return {
    connected,
    canModerate,
    viewerCount,
    slowModeSeconds,
    messages,
    status,
    hlsUrl,
    error,
    ...actions,
  };
}

function appendMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const existing = current.findIndex((message) => message.id === incoming.id);
  const next =
    existing >= 0
      ? current.map((message, index) => (index === existing ? incoming : message))
      : [...current, incoming];

  // A long class would otherwise grow this array without bound; nobody scrolls
  // back four hundred messages in a live room.
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}
