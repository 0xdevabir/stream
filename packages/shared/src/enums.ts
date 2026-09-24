/**
 * Enum values mirrored from the Prisma schema.
 *
 * The web app must not import `@prisma/client` (it would drag the query engine
 * into the browser bundle), so these literals are declared once here and the
 * Prisma schema is kept in lockstep. `packages/db/src/enum-parity.test.ts`
 * fails the build if the two ever drift.
 */

export const ORG_ROLES = ["OWNER", "ADMIN", "INSTRUCTOR", "STUDENT"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Ordered least- to most-privileged; used by `hasRole`. */
const ROLE_RANK: Record<OrgRole, number> = {
  STUDENT: 0,
  INSTRUCTOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasRole(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const STREAM_STATUSES = [
  "SCHEDULED",
  "LIVE",
  "PROCESSING",
  "ENDED",
  "CANCELLED",
] as const;
export type StreamStatus = (typeof STREAM_STATUSES)[number];

/**
 * How a viewer earns the right to watch.
 *  PUBLIC   - anyone, no sign-in
 *  LINK     - anyone holding the unguessable share link
 *  PASSWORD - anyone with the class password
 *  ENROLLED - only users with an Enrollment row
 *  ORG      - any member of the owning organization
 */
export const ACCESS_MODES = [
  "PUBLIC",
  "LINK",
  "PASSWORD",
  "ENROLLED",
  "ORG",
] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const RECORDING_STATUSES = [
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const MESSAGE_KINDS = ["CHAT", "QUESTION", "SYSTEM"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const LATENCY_MODES = ["LOW", "ULTRA"] as const;
export type LatencyMode = (typeof LATENCY_MODES)[number];

export const INGEST_PROTOCOLS = ["WHIP", "RTMP", "SRT"] as const;
export type IngestProtocol = (typeof INGEST_PROTOCOLS)[number];

export const WEBHOOK_DELIVERY_STATUSES = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];
