/**
 * Request/response contracts shared by the API and the web app.
 *
 * The API validates every inbound body against these; the web app reuses the
 * inferred types so a contract change surfaces as a compile error on both
 * sides rather than a runtime 400 in production.
 */
import { z } from "zod";

import { ACCESS_MODES, LATENCY_MODES, MESSAGE_KINDS } from "./enums";
import { RENDITION_NAMES } from "./ladder";

// ── Primitives ─────────────────────────────────────────────────────────────

export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email();

/**
 * Deliberately permissive on composition but strict on length. Length is the
 * property that actually resists offline cracking; character-class rules mostly
 * push people toward "Password1!".
 */
export const passwordSchema = z.string().min(10).max(200);

export const titleSchema = z.string().trim().min(1).max(200);

export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ── Auth ───────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
  /** Creating a brand-new organization; omit to join an existing one. */
  organizationName: z.string().trim().min(1).max(120).optional(),
  inviteToken: z.string().max(200).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  organizationId: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  role: z.enum(["OWNER", "ADMIN", "INSTRUCTOR", "STUDENT"]),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

// ── Streams ────────────────────────────────────────────────────────────────

export const accessModeSchema = z.enum(ACCESS_MODES);
export const latencyModeSchema = z.enum(LATENCY_MODES);

export const createStreamSchema = z
  .object({
    title: titleSchema,
    description: z.string().trim().max(5000).optional(),
    courseId: idSchema.optional(),
    scheduledAt: z.coerce.date().optional(),
    accessMode: accessModeSchema.default("ENROLLED"),
    /** Required when accessMode is PASSWORD. */
    password: z.string().min(4).max(200).optional(),
    latencyMode: latencyModeSchema.default("LOW"),
    recordEnabled: z.boolean().default(true),
    chatEnabled: z.boolean().default(true),
    questionsEnabled: z.boolean().default(true),
  })
  .refine((v) => v.accessMode !== "PASSWORD" || !!v.password, {
    message: "A password is required when accessMode is PASSWORD",
    path: ["password"],
  });
export type CreateStreamInput = z.infer<typeof createStreamSchema>;

export const updateStreamSchema = createStreamSchema
  .innerType()
  .partial()
  .extend({
    /** Clears the password and is only meaningful alongside a mode change. */
    removePassword: z.boolean().optional(),
  });
export type UpdateStreamInput = z.infer<typeof updateStreamSchema>;

export const listStreamsSchema = paginationSchema.extend({
  status: z
    .enum(["SCHEDULED", "LIVE", "PROCESSING", "ENDED", "CANCELLED"])
    .optional(),
  courseId: idSchema.optional(),
  mine: z.coerce.boolean().optional(),
});
export type ListStreamsInput = z.infer<typeof listStreamsSchema>;

export const streamSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(["SCHEDULED", "LIVE", "PROCESSING", "ENDED", "CANCELLED"]),
  accessMode: accessModeSchema,
  latencyMode: latencyModeSchema,
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  posterUrl: z.string().nullable(),
  recordEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  questionsEnabled: z.boolean(),
  viewerCount: z.number().int().nonnegative(),
  instructor: z.object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  recordingId: z.string().nullable(),
});
export type StreamSummary = z.infer<typeof streamSummarySchema>;

// ── Playback ───────────────────────────────────────────────────────────────

/**
 * Exchanged for a playback cookie. The password is only consulted for
 * PASSWORD-mode classes; the share token only for LINK-mode.
 */
export const requestPlaybackSchema = z.object({
  password: z.string().max(200).optional(),
  shareToken: z.string().max(200).optional(),
});
export type RequestPlaybackInput = z.infer<typeof requestPlaybackSchema>;

export const playbackGrantSchema = z.object({
  streamId: z.string(),
  status: z.enum(["SCHEDULED", "LIVE", "PROCESSING", "ENDED", "CANCELLED"]),
  /** Multivariant playlist for the HLS path. Null until the stream is live. */
  hlsUrl: z.string().nullable(),
  /** WHEP endpoint for the sub-second path. Null when unavailable. */
  whepUrl: z.string().nullable(),
  /**
   * WHEP cannot use the HttpOnly playback cookie: MediaMTX authorizes WebRTC
   * through its own hook, which only sees the URL's query string. So when the
   * ultra-low-latency path is offered, the same grant is also returned here
   * for the client to append to the WHEP URL. Null whenever `whepUrl` is.
   */
  whepToken: z.string().nullable(),
  /** Present once a replay exists. */
  vodUrl: z.string().nullable(),
  /** Wall-clock expiry of the playback cookie, ISO-8601. */
  expiresAt: z.string(),
  /** Renditions the viewer may request, highest first. */
  renditions: z.array(z.enum(RENDITION_NAMES)),
  chatEnabled: z.boolean(),
  questionsEnabled: z.boolean(),
});
export type PlaybackGrant = z.infer<typeof playbackGrantSchema>;

/** Issued to the instructor's browser so it can publish over WHIP. */
export const publishGrantSchema = z.object({
  streamId: z.string(),
  whipUrl: z.string(),
  /** Bearer token the WHIP POST must carry. Short-lived. */
  token: z.string(),
  expiresAt: z.string(),
  /** Credentials for instructors who prefer OBS. */
  rtmp: z.object({ url: z.string(), streamKey: z.string() }),
  srt: z.object({ url: z.string() }),
});
export type PublishGrant = z.infer<typeof publishGrantSchema>;

// ── Chat / Q&A ─────────────────────────────────────────────────────────────

export const messageKindSchema = z.enum(MESSAGE_KINDS);

export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  kind: z.enum(["CHAT", "QUESTION"]).default("CHAT"),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  kind: messageKindSchema,
  body: z.string(),
  createdAt: z.string(),
  pinned: z.boolean(),
  answered: z.boolean(),
  upvotes: z.number().int().nonnegative(),
  upvotedByMe: z.boolean(),
  author: z
    .object({
      id: z.string(),
      name: z.string(),
      avatarUrl: z.string().nullable(),
      isInstructor: z.boolean(),
    })
    .nullable(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ── Recordings ─────────────────────────────────────────────────────────────

export const recordingSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  title: z.string(),
  status: z.enum(["PENDING", "PROCESSING", "READY", "FAILED"]),
  durationSeconds: z.number().nonnegative().nullable(),
  sizeBytes: z.number().nonnegative().nullable(),
  posterUrl: z.string().nullable(),
  vodUrl: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  createdAt: z.string(),
  renditions: z.array(z.enum(RENDITION_NAMES)),
});
export type Recording = z.infer<typeof recordingSchema>;

// ── Enrollment ─────────────────────────────────────────────────────────────

export const enrollUsersSchema = z.object({
  /** Existing users by id, or invite-by-email for people not yet registered. */
  userIds: z.array(idSchema).max(500).default([]),
  emails: z.array(emailSchema).max(500).default([]),
});
export type EnrollUsersInput = z.infer<typeof enrollUsersSchema>;

// ── Errors ─────────────────────────────────────────────────────────────────

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ── Provider API (multi-tenant live + VOD) ─────────────────────────────────

export const PROVIDER_WEBHOOK_EVENTS = [
  "live.started",
  "live.ended",
  "video.ready",
  "video.failed",
] as const;
export type ProviderWebhookEvent = (typeof PROVIDER_WEBHOOK_EVENTS)[number];

export const createLiveInputSchema = z.object({
  name: titleSchema,
  record: z.boolean().default(true),
  /** Provider inputs default to token-gated PUBLIC media; access is the signed JWT. */
  metadata: z.record(z.string()).optional(),
});
export type CreateLiveInput = z.infer<typeof createLiveInputSchema>;

export const liveInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["SCHEDULED", "LIVE", "PROCESSING", "ENDED", "CANCELLED"]),
  record: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  ingest: z.object({
    rtmp: z.object({ url: z.string(), streamKey: z.string() }),
    srt: z.object({ url: z.string() }),
    whip: z.object({ url: z.string() }),
  }),
  playback: z.object({
    hlsUrl: z.string().nullable(),
    vodUrl: z.string().nullable(),
  }),
  recordingId: z.string().nullable(),
});
export type LiveInput = z.infer<typeof liveInputSchema>;

export const createPlaybackTokenSchema = z.object({
  /** Seconds until the token expires (capped server-side). */
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
});
export type CreatePlaybackTokenInput = z.infer<typeof createPlaybackTokenSchema>;

export const playbackTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  hlsUrl: z.string().nullable(),
  vodUrl: z.string().nullable(),
  /** Absolute playback URL with token query param for embeds. */
  signedHlsUrl: z.string().nullable(),
  signedVodUrl: z.string().nullable(),
});
export type PlaybackTokenResponse = z.infer<typeof playbackTokenSchema>;

export const providerVideoSchema = z.object({
  id: z.string(),
  liveInputId: z.string(),
  status: z.enum(["PENDING", "PROCESSING", "READY", "FAILED"]),
  durationSeconds: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  vodUrl: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
});
export type ProviderVideo = z.infer<typeof providerVideoSchema>;

export const createWebhookEndpointSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(PROVIDER_WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(16).max(200).optional(),
});
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;

export const webhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
  /** Only returned once at creation. */
  secret: z.string().optional(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const usageSummarySchema = z.object({
  liveMinutes: z.number(),
  tokensIssued: z.number(),
  concurrentLive: z.number(),
  maxConcurrentLives: z.number(),
  maxMinutesPerMonth: z.number(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

