"use client";

import type { ChatMessage } from "@stream/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { classNames, formatRelative } from "@/lib/format";

import type { RoomActions, RoomState } from "./useRoom";

type Tab = "chat" | "questions";

export type ChatPanelProps = {
  room: RoomState & RoomActions;
  chatEnabled: boolean;
  questionsEnabled: boolean;
  /** Signed-out viewers can read the room but not post into it. */
  canPost: boolean;
};

export function ChatPanel({
  room,
  chatEnabled,
  questionsEnabled,
  canPost,
}: ChatPanelProps) {
  const [tab, setTab] = useState<Tab>(chatEnabled ? "chat" : "questions");
  const [draft, setDraft] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const listRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const { chat, questions, pinned } = useMemo(() => split(room.messages), [
    room.messages,
  ]);
  const visible = tab === "chat" ? chat : questions;

  // Only autoscroll when the reader is already at the bottom. Yanking someone
  // back down while they are reading history is the classic chat-UI sin.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [visible.length, tab]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || cooldownLeft > 0) return;

    room.post(body, tab === "questions" ? "QUESTION" : "CHAT");
    setDraft("");

    if (room.slowModeSeconds > 0 && !room.canModerate) {
      const until = Date.now() + room.slowModeSeconds * 1000;
      setCooldownUntil(until);
      setNow(Date.now());
    }
  };

  return (
    <section className="card flex min-h-0 flex-col">
      <header className="border-ink-800 flex items-center gap-1 border-b px-2 py-2">
        {chatEnabled && (
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
            Chat
          </TabButton>
        )}
        {questionsEnabled && (
          <TabButton active={tab === "questions"} onClick={() => setTab("questions")}>
            Q&amp;A
            {questions.length > 0 && (
              <span className="bg-ink-800 ml-1.5 rounded-full px-1.5 text-[10px]">
                {questions.filter((message) => !message.answered).length}
              </span>
            )}
          </TabButton>
        )}

        <span className="ml-auto flex items-center gap-2 pr-1">
          {room.slowModeSeconds > 0 && (
            <span className="text-ink-500 text-[11px]">
              slow {room.slowModeSeconds}s
            </span>
          )}
          <span
            title={room.connected ? "Connected" : "Reconnecting"}
            className={classNames(
              "size-2 rounded-full",
              room.connected ? "bg-emerald-500" : "bg-amber-500",
            )}
          />
        </span>
      </header>

      {pinned && tab === "chat" && (
        <div className="border-brand-500/40 bg-brand-500/10 border-b px-3 py-2">
          <p className="text-brand-400 text-[10px] font-semibold tracking-wide uppercase">
            Pinned
          </p>
          <p className="mt-0.5 text-sm break-words">{pinned.body}</p>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {visible.length === 0 ? (
          <p className="text-ink-500 py-6 text-center text-xs">
            {tab === "chat"
              ? "No messages yet. Say hello."
              : "No questions yet. Ask the first one."}
          </p>
        ) : (
          visible.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              tab={tab}
              canModerate={room.canModerate}
              onVote={room.vote}
              onModerate={room.moderate}
            />
          ))
        )}
      </div>

      {room.canModerate && (
        <div className="border-ink-800 flex items-center gap-2 border-t px-3 py-2">
          <label className="text-ink-500 text-[11px]">Slow mode</label>
          <select
            value={room.slowModeSeconds}
            onChange={(event) => room.setSlowMode(Number(event.target.value))}
            className="bg-ink-950 border-ink-800 rounded border px-1.5 py-1 text-xs"
          >
            {[0, 5, 10, 30, 60].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0 ? "off" : `${seconds}s`}
              </option>
            ))}
          </select>
        </div>
      )}

      <form onSubmit={submit} className="border-ink-800 border-t p-2">
        {canPost ? (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={1000}
              placeholder={
                cooldownLeft > 0
                  ? `Wait ${cooldownLeft}s…`
                  : tab === "questions"
                    ? "Ask a question"
                    : "Message"
              }
              disabled={cooldownLeft > 0}
              className="input"
            />
            <Button type="submit" size="sm" disabled={!draft.trim() || cooldownLeft > 0}>
              Send
            </Button>
          </div>
        ) : (
          <p className="text-ink-500 py-1 text-center text-xs">
            Sign in to take part.
          </p>
        )}
      </form>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-lg px-3 py-1.5 text-sm transition-colors",
        active ? "bg-ink-800 text-ink-100" : "text-ink-500 hover:text-ink-300",
      )}
    >
      {children}
    </button>
  );
}

function MessageRow({
  message,
  tab,
  canModerate,
  onVote,
  onModerate,
}: {
  message: ChatMessage;
  tab: Tab;
  canModerate: boolean;
  onVote: RoomActions["vote"];
  onModerate: RoomActions["moderate"];
}) {
  const isQuestion = tab === "questions";

  return (
    <div
      className={classNames(
        "group/message rounded-lg px-2 py-1.5 text-sm",
        message.answered && "opacity-50",
        isQuestion && "bg-ink-950/60",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={classNames(
            "text-xs font-semibold",
            message.author?.isInstructor ? "text-brand-400" : "text-ink-300",
          )}
        >
          {message.author?.name ?? "Someone"}
          {message.author?.isInstructor && (
            <span className="bg-brand-600/30 text-brand-400 ml-1.5 rounded px-1 text-[9px] tracking-wide uppercase">
              host
            </span>
          )}
        </span>
        <span className="text-ink-500 text-[10px]">
          {formatRelative(message.createdAt)}
        </span>

        {canModerate && (
          <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
            {isQuestion ? (
              <ModAction
                label={message.answered ? "Reopen" : "Answered"}
                onClick={() =>
                  onModerate(message.id, message.answered ? "unanswer" : "answer")
                }
              />
            ) : (
              <ModAction
                label={message.pinned ? "Unpin" : "Pin"}
                onClick={() => onModerate(message.id, message.pinned ? "unpin" : "pin")}
              />
            )}
            <ModAction label="Delete" onClick={() => onModerate(message.id, "delete")} />
          </span>
        )}
      </div>

      <p className="mt-0.5 break-words whitespace-pre-wrap">{message.body}</p>

      {isQuestion && (
        <button
          type="button"
          onClick={() => onVote(message.id, !message.upvotedByMe)}
          className={classNames(
            "mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
            message.upvotedByMe
              ? "border-brand-500 text-brand-400"
              : "border-ink-700 text-ink-500 hover:text-ink-300",
          )}
        >
          <span aria-hidden>▲</span>
          {message.upvotes}
          <span className="sr-only">upvotes</span>
        </button>
      )}
    </div>
  );
}

function ModAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-ink-500 hover:text-ink-100 text-[10px] tracking-wide uppercase"
    >
      {label}
    </button>
  );
}

/**
 * Questions are sorted by votes rather than time: the point of the queue is to
 * surface what the room most wants answered, not what was typed last.
 */
function split(messages: ChatMessage[]) {
  const chat: ChatMessage[] = [];
  const questions: ChatMessage[] = [];
  let pinned: ChatMessage | null = null;

  for (const message of messages) {
    if (message.pinned) pinned = message;
    if (message.kind === "QUESTION") questions.push(message);
    else chat.push(message);
  }

  questions.sort((a, b) => {
    if (a.answered !== b.answered) return a.answered ? 1 : -1;
    if (a.upvotes !== b.upvotes) return b.upvotes - a.upvotes;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return { chat, questions, pinned };
}
