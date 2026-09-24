"use client";

import type { ChatMessage } from "@stream/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { SegmentedControl } from "@/components/ui";
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

  const openQuestions = questions.filter((message) => !message.answered).length;
  const tabs: Array<{ value: Tab; label: string }> = [];
  if (chatEnabled) tabs.push({ value: "chat", label: "Chat" });
  if (questionsEnabled) {
    tabs.push({ value: "questions", label: openQuestions ? `Q&A · ${openQuestions}` : "Q&A" });
  }

  return (
    <section className="card flex min-h-0 flex-col">
      <header className="flex items-center gap-3 px-3 pt-3 pb-2">
        {tabs.length > 1 ? (
          <SegmentedControl value={tab} onChange={setTab} options={tabs} className="flex-1" />
        ) : (
          <h2 className="flex-1 px-1 text-[17px] font-semibold">{tabs[0]?.label}</h2>
        )}
        <span className="flex shrink-0 items-center gap-2 pr-1">
          {room.slowModeSeconds > 0 && (
            <span className="text-ink-500 text-xs">{room.slowModeSeconds}s</span>
          )}
          <span
            title={room.connected ? "Connected" : "Reconnecting"}
            className={classNames(
              "size-2 rounded-full transition-colors",
              room.connected ? "bg-ok-500" : "bg-warn-500 animate-pulse",
            )}
          />
        </span>
      </header>

      {pinned && tab === "chat" && (
        <div className="bg-brand-500/10 animate-fade-in mx-3 mb-1 rounded-2xl px-3.5 py-2.5">
          <p className="text-brand-500 flex items-center gap-1 text-xs font-semibold">
            <svg viewBox="0 0 16 16" className="size-3 fill-current" aria-hidden>
              <path d="M10.5 1.5 14.5 5.5 12 6.5 9.5 9l.5 3.5-1 1L6 10.5 2.5 14l-.5-.5L5.5 10 2.5 7l1-1 3.5.5L9.5 4z" />
            </svg>
            Pinned
          </p>
          <p className="mt-0.5 text-[15px] break-words">{pinned.body}</p>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain scroll-smooth px-3 py-3"
      >
        {visible.length === 0 ? (
          <p className="text-ink-500 py-10 text-center text-[15px]">
            {tab === "chat" ? "No messages yet" : "No questions yet"}
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
        <div className="border-ink-800 flex items-center gap-2 border-t-[0.5px] px-4 py-2">
          <label htmlFor="slow-mode" className="text-ink-500 mr-auto text-[13px]">
            Slow mode
          </label>
          <select
            id="slow-mode"
            value={room.slowModeSeconds}
            onChange={(event) => room.setSlowMode(Number(event.target.value))}
            className="text-brand-500 bg-transparent text-base font-medium outline-none sm:text-[13px]"
          >
            {[0, 5, 10, 30, 60].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0 ? "Off" : `${seconds}s`}
              </option>
            ))}
          </select>
        </div>
      )}

      <form onSubmit={submit} className="border-ink-800 border-t-[0.5px] p-2.5">
        {canPost ? (
          <div className="bg-ink-850 focus-within:ring-brand-500/50 flex items-center rounded-full py-1 pr-1 pl-4 ring-1 ring-transparent transition-shadow focus-within:ring-2">
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
              className="placeholder:text-ink-500 min-w-0 flex-1 bg-transparent py-2 text-base outline-none sm:py-1.5 sm:text-[15px] disabled:opacity-60"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || cooldownLeft > 0}
              className="bg-brand-500 text-on-brand ease-spring grid size-8 shrink-0 place-items-center rounded-full transition-[transform,opacity] duration-300 active:scale-90 disabled:scale-75 disabled:opacity-0"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
                <path
                  d="M8 13V3.5M3.5 7.5 8 3l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ) : (
          <p className="text-ink-500 py-1.5 text-center text-[13px]">Sign in to take part.</p>
        )}
      </form>
    </section>
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
  const host = Boolean(message.author?.isInstructor);

  return (
    <div
      className={classNames(
        "group/message animate-fade-in",
        message.answered && "opacity-50",
      )}
    >
      <div className="mb-1 flex items-baseline gap-2 px-3">
        <span
          className={classNames(
            "text-xs font-semibold",
            host ? "text-brand-500" : "text-ink-500",
          )}
        >
          {message.author?.name ?? "Someone"}
          {host && " · Host"}
        </span>
        <span className="text-ink-500 text-[11px]">{formatRelative(message.createdAt)}</span>

        {canModerate && (
          <span className="ml-auto flex gap-2.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 focus-within:opacity-100">
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
            <ModAction label="Delete" destructive onClick={() => onModerate(message.id, "delete")} />
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <p
          className={classNames(
            "max-w-[85%] rounded-[18px] px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap",
            host ? "bg-brand-500 text-on-brand" : "bg-ink-850",
          )}
        >
          {message.body}
        </p>

        {isQuestion && (
          <button
            type="button"
            onClick={() => onVote(message.id, !message.upvotedByMe)}
            aria-pressed={message.upvotedByMe}
            className={classNames(
              "ease-spring inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-[transform,background-color,color] duration-300 active:scale-90",
              message.upvotedByMe
                ? "bg-brand-500 text-on-brand"
                : "bg-ink-850 text-ink-500 hover:text-ink-300",
            )}
          >
            <svg viewBox="0 0 12 12" className="size-2.5 fill-current" aria-hidden>
              <path d="M6 1.5 11 8H1z" />
            </svg>
            {message.upvotes}
            <span className="sr-only">upvotes</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ModAction({
  label,
  onClick,
  destructive = false,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "py-1 text-xs font-medium transition-opacity active:opacity-50",
        destructive ? "text-live-500" : "text-brand-500",
      )}
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
