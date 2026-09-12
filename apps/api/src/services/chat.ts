import type { ChatMessage as ChatMessageDto, MessageKind } from "@stream/shared";
import { type Prisma, prisma } from "@stream/db";

import { ApiError } from "../errors";
import { redis, slowModeKey } from "../redis";
import * as events from "./events";

/**
 * Chat and Q&A.
 *
 * Questions are the same rows as chat messages with `kind = QUESTION`, so the
 * instructor's Q&A queue is just a filtered, upvote-ordered view of one table
 * -- no second pipeline to keep in sync, and a student can upvote without the
 * message moving anywhere.
 */

const MESSAGE_INCLUDE = {
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ChatMessageInclude;

type MessageRow = Prisma.ChatMessageGetPayload<{
  include: typeof MESSAGE_INCLUDE;
}>;

export function serializeMessage(
  row: MessageRow,
  options: { instructorId: string; upvotedByMe: boolean },
): ChatMessageDto {
  return {
    id: row.id,
    streamId: row.streamId,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    pinned: row.pinned,
    answered: row.answered,
    upvotes: row.upvoteCount,
    upvotedByMe: options.upvotedByMe,
    author: row.user
      ? {
          id: row.user.id,
          name: row.user.name,
          avatarUrl: row.user.avatarUrl,
          isInstructor: row.user.id === options.instructorId,
        }
      : null,
  };
}

/**
 * Rate limiting for chat is per-stream slow mode rather than a global limit:
 * a busy class is normal traffic, and the thing an instructor actually wants
 * to control is how fast any one student can post.
 */
async function enforceSlowMode(
  streamId: string,
  userId: string,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;

  const key = slowModeKey(streamId, userId);
  // SET NX doubles as the check and the claim, so two rapid messages cannot
  // both pass.
  const claimed = await redis.set(key, "1", "EX", seconds, "NX");
  if (claimed !== "OK") {
    const remaining = await redis.ttl(key);
    throw ApiError.tooManyRequests(
      `Slow mode is on. Try again in ${Math.max(remaining, 1)}s.`,
    );
  }
}

export interface PostMessageOptions {
  streamId: string;
  instructorId: string;
  userId: string;
  body: string;
  kind: Extract<MessageKind, "CHAT" | "QUESTION">;
  slowModeSeconds: number;
  /** Moderators bypass slow mode. */
  isModerator: boolean;
  nonce?: string | undefined;
}

export async function postMessage(
  options: PostMessageOptions,
): Promise<ChatMessageDto> {
  if (!options.isModerator) {
    await enforceSlowMode(
      options.streamId,
      options.userId,
      options.slowModeSeconds,
    );
  }

  const row = await prisma.chatMessage.create({
    data: {
      streamId: options.streamId,
      userId: options.userId,
      kind: options.kind,
      body: options.body,
    },
    include: MESSAGE_INCLUDE,
  });

  const message = serializeMessage(row, {
    instructorId: options.instructorId,
    upvotedByMe: false,
  });

  await events.publish(options.streamId, {
    t: "message",
    message,
    ...(options.nonce ? { nonce: options.nonce } : {}),
  });

  return message;
}

export async function listRecent(options: {
  streamId: string;
  instructorId: string;
  viewerId: string | null;
  limit?: number;
}): Promise<ChatMessageDto[]> {
  const limit = Math.min(options.limit ?? 50, 200);

  const rows = await prisma.chatMessage.findMany({
    where: { streamId: options.streamId, deletedAt: null },
    include: MESSAGE_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const votes = await myVotes(
    options.viewerId,
    rows.map((row) => row.id),
  );

  return rows
    .reverse()
    .map((row) =>
      serializeMessage(row, {
        instructorId: options.instructorId,
        upvotedByMe: votes.has(row.id),
      }),
    );
}

/** The instructor's Q&A queue: unanswered questions, most-upvoted first. */
export async function listQuestions(options: {
  streamId: string;
  instructorId: string;
  viewerId: string | null;
  includeAnswered?: boolean;
  limit?: number;
}): Promise<ChatMessageDto[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      streamId: options.streamId,
      kind: "QUESTION",
      deletedAt: null,
      ...(options.includeAnswered ? {} : { answered: false }),
    },
    include: MESSAGE_INCLUDE,
    orderBy: [
      { pinned: "desc" },
      { upvoteCount: "desc" },
      { createdAt: "asc" },
    ],
    take: Math.min(options.limit ?? 100, 200),
  });

  const votes = await myVotes(
    options.viewerId,
    rows.map((row) => row.id),
  );

  return rows.map((row) =>
    serializeMessage(row, {
      instructorId: options.instructorId,
      upvotedByMe: votes.has(row.id),
    }),
  );
}

async function myVotes(
  viewerId: string | null,
  messageIds: string[],
): Promise<Set<string>> {
  if (!viewerId || messageIds.length === 0) return new Set();

  const rows = await prisma.questionVote.findMany({
    where: { userId: viewerId, messageId: { in: messageIds } },
    select: { messageId: true },
  });

  return new Set(rows.map((row) => row.messageId));
}

// ── Votes ─────────────────────────────────────────────────────────────────

export async function vote(
  messageId: string,
  userId: string,
  instructorId: string,
  up: boolean,
): Promise<ChatMessageDto | null> {
  // The unique constraint on (messageId, userId) is what makes this
  // idempotent, so a double-click cannot inflate the count.
  const changed = up
    ? await prisma.questionVote
        .create({ data: { messageId, userId } })
        .then(() => true)
        .catch(() => false)
    : await prisma.questionVote
        .delete({ where: { messageId_userId: { messageId, userId } } })
        .then(() => true)
        .catch(() => false);

  if (!changed) return null;

  const row = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { upvoteCount: { increment: up ? 1 : -1 } },
    include: MESSAGE_INCLUDE,
  });

  const message = serializeMessage(row, { instructorId, upvotedByMe: up });
  await events.publish(row.streamId, { t: "message_update", message });
  return message;
}

// ── Moderation ────────────────────────────────────────────────────────────

export type ModerationAction =
  | "delete"
  | "pin"
  | "unpin"
  | "answer"
  | "unanswer";

export async function moderate(options: {
  messageId: string;
  action: ModerationAction;
  moderatorId: string;
  instructorId: string;
}): Promise<void> {
  const existing = await prisma.chatMessage.findUnique({
    where: { id: options.messageId },
    select: { streamId: true },
  });
  if (!existing) throw ApiError.notFound("Message not found");

  if (options.action === "delete") {
    // Soft delete: moderation history is worth keeping, and a hard delete
    // would break the upvote rows that reference it.
    await prisma.chatMessage.update({
      where: { id: options.messageId },
      data: { deletedAt: new Date(), deletedById: options.moderatorId },
    });
    await events.publish(existing.streamId, {
      t: "message_delete",
      id: options.messageId,
    });
    return;
  }

  const data: Prisma.ChatMessageUpdateInput = {};

  switch (options.action) {
    case "pin":
      data.pinned = true;
      break;
    case "unpin":
      data.pinned = false;
      break;
    case "answer":
      data.answered = true;
      break;
    case "unanswer":
      data.answered = false;
      break;
  }

  const row = await prisma.chatMessage.update({
    where: { id: options.messageId },
    data,
    include: MESSAGE_INCLUDE,
  });

  await events.publish(row.streamId, {
    t: "message_update",
    message: serializeMessage(row, {
      instructorId: options.instructorId,
      upvotedByMe: false,
    }),
  });
}

export async function setSlowMode(
  streamId: string,
  seconds: number,
): Promise<void> {
  await prisma.stream.update({
    where: { id: streamId },
    data: { slowModeSeconds: seconds },
  });
  await events.publish(streamId, { t: "slowmode", seconds });
}
