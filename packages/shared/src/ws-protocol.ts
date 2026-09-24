/**
 * The live WebSocket protocol for a stream room (chat, Q&A, presence, status).
 *
 * Kept as a discriminated union on `t` so both ends get exhaustiveness checks
 * from the compiler. Payloads are small on purpose: at a few thousand viewers
 * the fanout cost is dominated by message size, so we send ids and deltas
 * rather than re-sending whole objects where we can.
 */
import { z } from "zod";

import { chatMessageSchema, postMessageSchema } from "./contracts";
import { RENDITION_NAMES } from "./ladder";

// ── Client -> server ───────────────────────────────────────────────────────

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),

  z.object({
    t: z.literal("chat"),
    body: postMessageSchema.shape.body,
    kind: postMessageSchema.shape.kind,
    /** Echoed back so the sender can reconcile its optimistic bubble. */
    nonce: z.string().max(64),
  }),

  z.object({ t: z.literal("upvote"), messageId: z.string().max(64) }),
  z.object({ t: z.literal("unvote"), messageId: z.string().max(64) }),

  /** Instructor / moderator actions. Rejected with an error for students. */
  z.object({
    t: z.literal("moderate"),
    action: z.enum(["delete", "pin", "unpin", "answer", "unanswer"]),
    messageId: z.string().max(64),
  }),

  z.object({ t: z.literal("slowmode"), seconds: z.number().int().min(0).max(300) }),

  /** Viewer telemetry, used for the quality-distribution panel. */
  z.object({
    t: z.literal("quality"),
    rendition: z.enum(RENDITION_NAMES),
    droppedFrames: z.number().int().nonnegative().max(1_000_000).optional(),
    bufferSeconds: z.number().nonnegative().max(600).optional(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ── Server -> client ───────────────────────────────────────────────────────

export const serverMessageSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello"),
    viewerCount: z.number().int().nonnegative(),
    canModerate: z.boolean(),
    slowModeSeconds: z.number().int().nonnegative(),
    /** True while the class is open but its publisher has dropped (see `paused`). */
    paused: z.boolean().default(false),
    /** Most recent messages so a late joiner sees context immediately. */
    backlog: z.array(chatMessageSchema),
  }),

  z.object({ t: z.literal("pong") }),

  z.object({
    t: z.literal("message"),
    message: chatMessageSchema,
    nonce: z.string().optional(),
  }),

  z.object({ t: z.literal("message_update"), message: chatMessageSchema }),
  z.object({ t: z.literal("message_delete"), id: z.string() }),

  z.object({ t: z.literal("viewers"), count: z.number().int().nonnegative() }),

  z.object({
    t: z.literal("status"),
    status: z.enum(["SCHEDULED", "LIVE", "PROCESSING", "ENDED", "CANCELLED"]),
    hlsUrl: z.string().nullable(),
  }),

  z.object({ t: z.literal("slowmode"), seconds: z.number().int().nonnegative() }),

  /**
   * The instructor stopped sending without ending the class. Viewers get a
   * "paused" screen instead of a frozen frame; `false` means media is back.
   */
  z.object({ t: z.literal("paused"), paused: z.boolean() }),

  z.object({
    t: z.literal("error"),
    code: z.string(),
    message: z.string(),
    /** Set when the client should stop retrying (auth failure, ban). */
    fatal: z.boolean().default(false),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Redis pub/sub channel carrying a room's fanout across API instances. */
export function streamChannel(streamId: string): string {
  return `stream:${streamId}:events`;
}

/** Redis sorted-set key holding live viewer heartbeats for a room. */
export function presenceKey(streamId: string): string {
  return `stream:${streamId}:presence`;
}

/** How often clients heartbeat, and how long a heartbeat stays valid. */
export const PRESENCE_HEARTBEAT_MS = 15_000;
export const PRESENCE_TTL_MS = 45_000;
