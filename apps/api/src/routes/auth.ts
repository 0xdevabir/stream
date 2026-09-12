import { createHash } from "node:crypto";

import { type SessionUser, loginSchema, registerSchema } from "@stream/shared";
import {
  burnPasswordTiming,
  hashIp,
  hashPassword,
  prisma,
  slugify,
  verifyPassword,
} from "@stream/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  clearAuthCookies,
  issueCsrfToken,
  setAccessCookie,
  setRefreshCookie,
} from "../auth/cookies";
import { COOKIE } from "../auth/cookies";
import { requireAuth } from "../auth/session";
import { generateRefreshToken, signAccessToken } from "../auth/tokens";
import { env } from "../env";
import { ApiError } from "../errors";
import * as validate from "../validate";

/**
 * Refresh tokens are stored as a SHA-256 hash. They are high-entropy random
 * strings rather than user-chosen passwords, so there is nothing for an
 * attacker to brute-force and a fast hash is the right choice -- this lookup
 * happens on every token refresh.
 */
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

async function buildSession(userId: string): Promise<SessionUser> {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!membership) {
    throw ApiError.forbidden("This account is not a member of any organization");
  }

  return {
    id: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    avatarUrl: membership.user.avatarUrl,
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    role: membership.role,
  };
}

async function startSession(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<SessionUser> {
  const session = await buildSession(userId);

  const accessToken = await signAccessToken({
    userId: session.id,
    organizationId: session.organizationId,
    role: session.role,
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
      userAgent: request.headers["user-agent"]?.slice(0, 400) ?? null,
      ipHash: hashIp(request.ip, env.AUTH_SECRET),
    },
  });

  setAccessCookie(reply, accessToken);
  setRefreshCookie(reply, refreshToken);
  issueCsrfToken(reply);

  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });

  return session;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/register",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const input = validate.body(registerSchema, request);

      const existing = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existing) {
        // Registration inherently reveals whether an address is taken, so
        // there is nothing to gain by being vague -- and a clear message
        // saves the user a support ticket.
        throw ApiError.conflict("An account with that email already exists");
      }

      const invitation = input.inviteToken
        ? await prisma.invitation.findUnique({
            where: { token: input.inviteToken },
          })
        : null;

      if (input.inviteToken) {
        if (
          !invitation ||
          invitation.acceptedAt !== null ||
          invitation.expiresAt < new Date()
        ) {
          throw ApiError.badRequest("That invitation is invalid or has expired");
        }
        if (invitation.email !== input.email) {
          throw ApiError.badRequest(
            "That invitation was issued for a different email address",
          );
        }
      } else if (!input.organizationName) {
        throw ApiError.badRequest(
          "Provide either an invitation token or a new organization name",
        );
      }

      const passwordHash = await hashPassword(input.password);

      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash },
        });

        if (invitation) {
          await tx.membership.create({
            data: {
              userId: created.id,
              organizationId: invitation.organizationId,
              role: invitation.role,
            },
          });
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date() },
          });
          if (invitation.streamId) {
            await tx.enrollment.create({
              data: { userId: created.id, streamId: invitation.streamId },
            });
          }
        } else {
          const organization = await tx.organization.create({
            data: {
              name: input.organizationName!,
              slug: slugify(input.organizationName!),
            },
          });
          // Whoever creates the organization owns it.
          await tx.membership.create({
            data: {
              userId: created.id,
              organizationId: organization.id,
              role: "OWNER",
            },
          });
        }

        return created;
      });

      const session = await startSession(request, reply, user.id);
      return reply.code(201).send({ user: session });
    },
  );

  app.post(
    "/login",
    {
      config: {
        // Slow enough to make credential stuffing impractical, loose enough
        // that a student mistyping a password a few times is not locked out.
        rateLimit: { max: 20, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const input = validate.body(loginSchema, request);

      const user = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true, passwordHash: true },
      });

      if (!user) {
        // Spend comparable CPU on the miss so response time does not reveal
        // whether the address exists.
        await burnPasswordTiming(input.password);
        throw ApiError.unauthorized("Incorrect email or password");
      }

      const valid = await verifyPassword(user.passwordHash, input.password);
      if (!valid) throw ApiError.unauthorized("Incorrect email or password");

      const session = await startSession(request, reply, user.id);
      return { user: session };
    },
  );

  app.post("/refresh", async (request, reply) => {
    const token = request.cookies[COOKIE.refresh];
    if (!token) throw ApiError.unauthorized("No refresh token");

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      clearAuthCookies(reply);
      throw ApiError.unauthorized("Session expired, please sign in again");
    }

    // Rotate on every use: a refresh token is single-use, so a stolen one
    // stops working the moment the legitimate client refreshes.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const session = await startSession(request, reply, stored.userId);
    return { user: session };
  });

  app.post("/logout", async (request, reply) => {
    const token = request.cookies[COOKIE.refresh];
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.get("/me", async (request) => {
    const auth = requireAuth(request);
    return { user: await buildSession(auth.userId) };
  });
}
