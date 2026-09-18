import {
  addConsoleUserSchema,
  createTenantAdminSchema,
  resetConsolePasswordSchema,
  updateTenantAdminSchema,
} from "@stream/shared";
import { generateApiKey, hashPassword, prisma } from "@stream/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/session";
import { ApiError } from "../errors";
import * as liveInputs from "../services/live-inputs";
import * as tenants from "../services/tenants";
import * as usage from "../services/usage";
import * as validate from "../validate";

const idParam = z.object({ id: z.string().min(1).max(128) });
const tenantKeyParam = z.object({
  id: z.string().min(1).max(128),
  keyId: z.string().min(1).max(128),
});
const tenantLiveParam = z.object({
  id: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
});

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(120).default("Default"),
});

async function requirePlatformAdmin(request: FastifyRequest): Promise<void> {
  const auth = requireAuth(request);
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { platformAdmin: true },
  });
  if (!user?.platformAdmin) {
    throw ApiError.forbidden("Platform admin access required");
  }
}

function startOfMonth(): Date {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart;
}

async function tenantContext(tenantId: string): Promise<tenants.TenantContext> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });
  if (!tenant) throw ApiError.notFound("Tenant not found");
  return {
    tenantId: tenant.id,
    organizationId: tenant.organizationId,
    serviceUserId: tenant.serviceUserId,
    apiKeyId: "admin",
    scopes: ["*"],
    maxConcurrentLives: tenant.maxConcurrentLives,
    maxMinutesPerMonth: tenant.maxMinutesPerMonth,
    name: tenant.name,
    slug: tenant.slug,
  };
}

/**
 * Cookie-authenticated platform (super-admin) API.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requirePlatformAdmin);

  app.get("/me", async () => {
    const tenantCount = await prisma.tenant.count();
    const liveCount = await prisma.stream.count({ where: { status: "LIVE" } });
    const videoCount = await prisma.recording.count();
    const monthStart = startOfMonth();
    const usageRows = await prisma.usageEvent.groupBy({
      by: ["kind"],
      where: { createdAt: { gte: monthStart } },
      _sum: { quantity: true },
    });
    const byKind = Object.fromEntries(
      usageRows.map((row) => [row.kind, row._sum.quantity ?? 0]),
    );

    return {
      tenants: tenantCount,
      concurrentLive: liveCount,
      videos: videoCount,
      month: {
        liveMinutes: byKind.LIVE_MINUTE ?? 0,
        tokensIssued: byKind.TOKEN_ISSUED ?? 0,
      },
    };
  });

  app.get("/usage", async () => {
    const monthStart = startOfMonth();
    const tenantsRows = await prisma.tenant.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        maxConcurrentLives: true,
        maxMinutesPerMonth: true,
      },
    });

    const items = await Promise.all(
      tenantsRows.map(async (tenant) => {
        const summary = await usage.summarizeUsage(tenant.id, monthStart);
        const concurrentLive = await usage.countConcurrentLives(tenant.id);
        return {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          concurrentLive,
          maxConcurrentLives: tenant.maxConcurrentLives,
          liveMinutes: summary.liveMinutes,
          maxMinutesPerMonth: tenant.maxMinutesPerMonth,
          tokensIssued: summary.tokensIssued,
        };
      }),
    );

    const totals = items.reduce(
      (acc, row) => ({
        concurrentLive: acc.concurrentLive + row.concurrentLive,
        liveMinutes: acc.liveMinutes + row.liveMinutes,
        tokensIssued: acc.tokensIssued + row.tokensIssued,
      }),
      { concurrentLive: 0, liveMinutes: 0, tokensIssued: 0 },
    );

    return { monthStart: monthStart.toISOString(), totals, items };
  });

  app.get("/live_inputs", async () => {
    const streams = await prisma.stream.findMany({
      where: { tenantId: { not: null } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    return {
      items: streams.map((stream) => ({
        id: stream.id,
        name: stream.title,
        status: stream.status,
        recordEnabled: stream.recordEnabled,
        tenantId: stream.tenant?.id ?? null,
        tenantName: stream.tenant?.name ?? null,
        tenantSlug: stream.tenant?.slug ?? null,
        createdAt: stream.createdAt.toISOString(),
        startedAt: stream.startedAt?.toISOString() ?? null,
      })),
    };
  });

  app.get("/tenants", async () => {
    const monthStart = startOfMonth();
    const rows = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { apiKeys: true } },
        organization: { select: { id: true, slug: true } },
      },
    });

    const items = await Promise.all(
      rows.map(async (tenant) => {
        const summary = await usage.summarizeUsage(tenant.id, monthStart);
        const concurrentLive = await usage.countConcurrentLives(tenant.id);
        return {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          organizationId: tenant.organizationId,
          maxConcurrentLives: tenant.maxConcurrentLives,
          maxMinutesPerMonth: tenant.maxMinutesPerMonth,
          apiKeyCount: tenant._count.apiKeys,
          concurrentLive,
          liveMinutes: summary.liveMinutes,
          tokensIssued: summary.tokensIssued,
          createdAt: tenant.createdAt.toISOString(),
        };
      }),
    );

    return { items };
  });

  app.get("/tenants/:id", async (request) => {
    const { id } = validate.params(idParam, request);
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        apiKeys: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            keyPrefix: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
          },
        },
        organization: {
          select: {
            id: true,
            slug: true,
            memberships: {
              where: {
                user: { email: { not: { startsWith: "provider+" } } },
              },
              include: {
                user: { select: { id: true, email: true, name: true } },
              },
              take: 50,
            },
          },
        },
      },
    });
    if (!tenant) throw ApiError.notFound("Tenant not found");

    const monthStart = startOfMonth();
    const summary = await usage.summarizeUsage(tenant.id, monthStart);
    const concurrentLive = await usage.countConcurrentLives(tenant.id);
    const liveInputs = await prisma.stream.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        recordEnabled: true,
        createdAt: true,
        startedAt: true,
      },
    });
    const videos = await prisma.recording.count({
      where: { stream: { tenantId: tenant.id } },
    });

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      organizationId: tenant.organizationId,
      maxConcurrentLives: tenant.maxConcurrentLives,
      maxMinutesPerMonth: tenant.maxMinutesPerMonth,
      concurrentLive,
      liveMinutes: summary.liveMinutes,
      tokensIssued: summary.tokensIssued,
      videoCount: videos,
      createdAt: tenant.createdAt.toISOString(),
      apiKeys: tenant.apiKeys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      })),
      consoleUsers: tenant.organization.memberships.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
      })),
      liveInputs: liveInputs.map((row) => ({
        id: row.id,
        name: row.title,
        status: row.status,
        recordEnabled: row.recordEnabled,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post("/tenants", async (request, reply) => {
    const input = validate.body(createTenantAdminSchema, request);
    const created = await tenants.createTenant({
      name: input.name,
      maxConcurrentLives: input.maxConcurrentLives,
      maxMinutesPerMonth: input.maxMinutesPerMonth,
      consoleEmail: input.consoleEmail,
      consolePassword: input.consolePassword,
    });

    return reply.code(201).send({
      id: created.tenantId,
      slug: created.slug,
      organizationId: created.organizationId,
      apiKey: created.apiKey,
      apiKeyPrefix: created.apiKeyPrefix,
      consoleEmail: created.consoleEmail,
      consolePassword: created.consolePassword,
      note: "Store apiKey and consolePassword now; they cannot be recovered.",
    });
  });

  app.patch("/tenants/:id", async (request) => {
    const { id } = validate.params(idParam, request);
    const input = validate.body(updateTenantAdminSchema, request);
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound("Tenant not found");

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.maxConcurrentLives !== undefined
          ? { maxConcurrentLives: input.maxConcurrentLives }
          : {}),
        ...(input.maxMinutesPerMonth !== undefined
          ? { maxMinutesPerMonth: input.maxMinutesPerMonth }
          : {}),
      },
    });

    if (input.name !== undefined) {
      await prisma.organization.update({
        where: { id: tenant.organizationId },
        data: { name: input.name },
      });
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      maxConcurrentLives: tenant.maxConcurrentLives,
      maxMinutesPerMonth: tenant.maxMinutesPerMonth,
    };
  });

  app.post("/tenants/:id/console-users", async (request, reply) => {
    const { id } = validate.params(idParam, request);
    const input = validate.body(addConsoleUserSchema, request);
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw ApiError.notFound("Tenant not found");

    const passwordHash = await hashPassword(input.password);
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });

    let userId: string;
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: input.name, passwordHash },
      });
      userId = existing.id;
      await prisma.membership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId: tenant.organizationId,
          },
        },
        update: { role: "OWNER" },
        create: {
          userId,
          organizationId: tenant.organizationId,
          role: "OWNER",
        },
      });
    } else {
      const created = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          memberships: {
            create: {
              organizationId: tenant.organizationId,
              role: "OWNER",
            },
          },
        },
      });
      userId = created.id;
    }

    return reply.code(201).send({
      id: userId,
      email: input.email,
      name: input.name,
      password: input.password,
      note: "Password shown once in this response.",
    });
  });

  app.post("/tenants/:id/console-users/reset-password", async (request) => {
    const { id } = validate.params(idParam, request);
    const input = validate.body(resetConsolePasswordSchema, request);
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw ApiError.notFound("Tenant not found");

    const membership = await prisma.membership.findFirst({
      where: {
        organizationId: tenant.organizationId,
        user: { email: input.email },
      },
      include: { user: true },
    });
    if (!membership) {
      throw ApiError.notFound("Console user not found on this tenant");
    }

    await prisma.user.update({
      where: { id: membership.userId },
      data: { passwordHash: await hashPassword(input.password) },
    });

    return {
      email: input.email,
      password: input.password,
      note: "Password shown once in this response.",
    };
  });

  app.post("/tenants/:id/api-keys", async (request, reply) => {
    const { id } = validate.params(idParam, request);
    const body = validate.body(createKeySchema, request);
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw ApiError.notFound("Tenant not found");

    const generated = generateApiKey();
    const record = await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: body.name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
      },
    });

    return reply.code(201).send({
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      createdAt: record.createdAt.toISOString(),
      apiKey: generated.raw,
      note: "Store the apiKey now; it cannot be recovered.",
    });
  });

  app.delete("/tenants/:id/api-keys/:keyId", async (request, reply) => {
    const { id, keyId } = validate.params(tenantKeyParam, request);
    const key = await prisma.apiKey.findFirst({
      where: { id: keyId, tenantId: id },
    });
    if (!key) throw ApiError.notFound("API key not found");

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return reply.code(204).send();
  });

  app.delete("/tenants/:id/live_inputs/:liveId", async (request, reply) => {
    const { id, liveId } = validate.params(tenantLiveParam, request);
    const ctx = await tenantContext(id);
    await liveInputs.deleteLiveInput(ctx, liveId);
    return reply.code(204).send();
  });
}
