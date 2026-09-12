import { type AccessMode, type OrgRole, hasRole } from "@stream/shared";
import { prisma, verifyPassword } from "@stream/db";

/**
 * The one place that decides whether somebody may watch a class.
 *
 * Every entry point funnels through here -- the playback-grant endpoint, the
 * edge's auth_request, the AES key endpoint, the WebSocket handshake, and
 * MediaMTX's WHEP hook -- so there is exactly one implementation of the rules
 * to reason about and to test.
 */

/** What we know about the caller. */
export interface AccessContext {
  userId: string | null;
  organizationId: string | null;
  role: OrgRole | null;
  /** Supplied for PASSWORD-mode classes. */
  password?: string | undefined;
  /** Supplied for LINK-mode classes. */
  shareToken?: string | undefined;
}

/** The subset of a Stream row the decision depends on. */
export interface AccessSubject {
  id: string;
  organizationId: string;
  instructorId: string;
  courseId: string | null;
  accessMode: AccessMode;
  passwordHash: string | null;
  shareToken: string;
}

export type AccessDenialReason =
  | "authentication_required"
  | "password_required"
  | "invalid_password"
  | "invalid_link"
  | "not_enrolled"
  | "not_in_organization";

export type AccessDecision =
  | { allowed: true; role: "instructor" | "admin" | "viewer" }
  | { allowed: false; reason: AccessDenialReason };

/**
 * Facts gathered from the database, separated from the rules so the rules can
 * be tested exhaustively without a database.
 */
export interface AccessFacts {
  isStreamInstructor: boolean;
  isOrgAdmin: boolean;
  isOrgMember: boolean;
  isEnrolled: boolean;
  shareTokenMatches: boolean;
  passwordProvided: boolean;
  passwordMatches: boolean;
}

/**
 * Pure decision function.
 *
 * Note the ordering: the instructor and org-admin short-circuits come first,
 * so an instructor is never locked out of their own class by a forgotten
 * password or a missing enrollment row.
 */
export function decideAccess(
  accessMode: AccessMode,
  facts: AccessFacts,
): AccessDecision {
  if (facts.isStreamInstructor) return { allowed: true, role: "instructor" };
  if (facts.isOrgAdmin) return { allowed: true, role: "admin" };

  switch (accessMode) {
    case "PUBLIC":
      return { allowed: true, role: "viewer" };

    case "LINK":
      return facts.shareTokenMatches
        ? { allowed: true, role: "viewer" }
        : { allowed: false, reason: "invalid_link" };

    case "PASSWORD":
      if (!facts.passwordProvided) {
        return { allowed: false, reason: "password_required" };
      }
      return facts.passwordMatches
        ? { allowed: true, role: "viewer" }
        : { allowed: false, reason: "invalid_password" };

    case "ORG":
      if (!facts.isOrgMember) {
        return {
          allowed: false,
          reason: facts.isEnrolled ? "not_in_organization" : "authentication_required",
        };
      }
      return { allowed: true, role: "viewer" };

    case "ENROLLED":
      if (facts.isEnrolled) return { allowed: true, role: "viewer" };
      return {
        allowed: false,
        reason: facts.isOrgMember ? "not_enrolled" : "authentication_required",
      };

    default: {
      // Exhaustiveness guard: a new AccessMode must be handled explicitly
      // rather than silently falling through to "allowed".
      const exhaustive: never = accessMode;
      throw new Error(`Unhandled access mode: ${String(exhaustive)}`);
    }
  }
}

/**
 * Gathers the facts, then applies the rules.
 *
 * Only the queries the mode actually needs are run: a PUBLIC class costs zero
 * queries, and the argon2 password verification (deliberately ~50ms) happens
 * only for PASSWORD-mode classes.
 */
export async function resolveStreamAccess(
  stream: AccessSubject,
  context: AccessContext,
): Promise<AccessDecision> {
  const isStreamInstructor =
    context.userId !== null && context.userId === stream.instructorId;

  const sameOrg =
    context.organizationId !== null &&
    context.organizationId === stream.organizationId;

  const isOrgAdmin =
    sameOrg && context.role !== null && hasRole(context.role, "ADMIN");

  // Short-circuit before touching the database or burning CPU on argon2.
  if (isStreamInstructor || isOrgAdmin) {
    return decideAccess(stream.accessMode, {
      isStreamInstructor,
      isOrgAdmin,
      isOrgMember: sameOrg,
      isEnrolled: false,
      shareTokenMatches: false,
      passwordProvided: false,
      passwordMatches: false,
    });
  }

  const needsEnrollment = stream.accessMode === "ENROLLED";
  const needsPassword = stream.accessMode === "PASSWORD";
  const needsLink = stream.accessMode === "LINK";

  const isEnrolled =
    needsEnrollment && context.userId
      ? await isUserEnrolled(context.userId, stream)
      : false;

  const passwordProvided = needsPassword && !!context.password;
  const passwordMatches =
    passwordProvided && stream.passwordHash
      ? await verifyPassword(stream.passwordHash, context.password!)
      : false;

  const shareTokenMatches =
    needsLink && !!context.shareToken
      ? constantTimeEquals(context.shareToken, stream.shareToken)
      : false;

  return decideAccess(stream.accessMode, {
    isStreamInstructor,
    isOrgAdmin,
    isOrgMember: sameOrg,
    isEnrolled,
    shareTokenMatches,
    passwordProvided,
    passwordMatches,
  });
}

/**
 * Enrollment is satisfied either per-class or through the parent course, so an
 * instructor can enroll a cohort once instead of per lecture.
 */
async function isUserEnrolled(
  userId: string,
  stream: Pick<AccessSubject, "id" | "courseId">,
): Promise<boolean> {
  const [direct, viaCourse] = await Promise.all([
    prisma.enrollment.findUnique({
      where: { userId_streamId: { userId, streamId: stream.id } },
      select: { id: true },
    }),
    stream.courseId
      ? prisma.courseEnrollment.findUnique({
          where: { userId_courseId: { userId, courseId: stream.courseId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  return direct !== null || viaCourse !== null;
}

/** Share tokens are secrets, so compare them without leaking length or prefix. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Whether the caller may moderate chat and control the stream. */
export function canModerate(
  stream: Pick<AccessSubject, "organizationId" | "instructorId">,
  context: AccessContext,
): boolean {
  if (context.userId && context.userId === stream.instructorId) return true;
  return (
    context.organizationId === stream.organizationId &&
    context.role !== null &&
    hasRole(context.role, "ADMIN")
  );
}

/** Maps a denial to the HTTP status the client should see. */
export function denialStatus(reason: AccessDenialReason): 401 | 403 {
  return reason === "authentication_required" ? 401 : 403;
}
