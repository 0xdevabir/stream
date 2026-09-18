import {
  createLiveInputSchema,
  createPlaybackTokenSchema,
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from "@stream/shared";
import { generateApiKey, prisma } from "@stream/db";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/session";
import { ApiError } from "../errors";
import * as liveInputs from "../services/live-inputs";
import {
  type TenantContext,
  resolveTenantFromOrganization,
} from "../services/tenants";
import * as usage from "../services/usage";
import * as validate from "../validate";

declare module "fastify" {
  interface FastifyRequest {
    consoleTenant?: TenantContext;
  }
}

const idParam = z.object({ id: z.string().min(1).max(128) });

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(120).default("Default"),
});

async function loadConsoleTenant(request: FastifyRequest): Promise<void> {
  const auth = requireAuth(request);
  request.consoleTenant = await resolveTenantFromOrganization(
    auth.organizationId,
  );
}

/**
 * Cookie-authenticated developer console API.
 * Resolves Tenant from the signed-in user's organization.
 */
export async function consoleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", loadConsoleTenant);

  app.get("/me", async (request) => {
    const ctx = request.consoleTenant!;
    const concurrentLive = await usage.countConcurrentLives(ctx.tenantId);
    const monthStart = startOfMonth();
    const summary = await usage.summarizeUsage(ctx.tenantId, monthStart);

    return {
      tenant: {
        id: ctx.tenantId,
        name: ctx.name,
        slug: ctx.slug,
        maxConcurrentLives: ctx.maxConcurrentLives,
        maxMinutesPerMonth: ctx.maxMinutesPerMonth,
      },
      usage: {
        concurrentLive,
        liveMinutes: summary.liveMinutes,
        tokensIssued: summary.tokensIssued,
      },
    };
  });

  app.get("/live_inputs", async (request) => {
    const items = await liveInputs.listLiveInputs(request.consoleTenant!);
    return { items };
  });

  app.post("/live_inputs", async (request, reply) => {
    const input = validate.body(createLiveInputSchema, request);
    const { liveInput } = await liveInputs.createLiveInput(
      request.consoleTenant!,
      input,
    );
    return reply.code(201).send(liveInput);
  });

  app.get("/live_inputs/:id", async (request) => {
    const { id } = validate.params(idParam, request);
    return liveInputs.getLiveInput(request.consoleTenant!, id);
  });

  app.post("/live_inputs/:id/token", async (request) => {
    const { id } = validate.params(idParam, request);
    const body = validate.body(createPlaybackTokenSchema, request);
    return liveInputs.mintPlaybackToken(request.consoleTenant!, id, {
      ttlSeconds: body.ttlSeconds,
    });
  });

  app.delete("/live_inputs/:id", async (request, reply) => {
    const { id } = validate.params(idParam, request);
    await liveInputs.deleteLiveInput(request.consoleTenant!, id);
    return reply.code(204).send();
  });

  app.get("/videos", async (request) => {
    const items = await liveInputs.listVideos(request.consoleTenant!);
    return { items };
  });

  app.get("/videos/:id", async (request) => {
    const { id } = validate.params(idParam, request);
    return liveInputs.getVideo(request.consoleTenant!, id);
  });

  app.get("/api-keys", async (request) => {
    const ctx = request.consoleTenant!;
    const keys = await prisma.apiKey.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      })),
    };
  });

  app.post("/api-keys", async (request, reply) => {
    const ctx = request.consoleTenant!;
    const body = validate.body(createKeySchema, request);
    const generated = generateApiKey();
    const record = await prisma.apiKey.create({
      data: {
        tenantId: ctx.tenantId,
        name: body.name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
      },
    });

    return reply.code(201).send({
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      scopes: record.scopes,
      createdAt: record.createdAt.toISOString(),
      /** Shown once — store it now. */
      apiKey: generated.raw,
    });
  });

  app.delete("/api-keys/:id", async (request, reply) => {
    const ctx = request.consoleTenant!;
    const { id } = validate.params(idParam, request);
    const key = await prisma.apiKey.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!key) throw ApiError.notFound("API key not found");

    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return reply.code(204).send();
  });

  app.get("/webhooks", async (request) => {
    const ctx = request.consoleTenant!;
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: endpoints.map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        events: endpoint.events,
        enabled: endpoint.enabled,
        createdAt: endpoint.createdAt.toISOString(),
      })),
    };
  });

  app.post("/webhooks", async (request, reply) => {
    const ctx = request.consoleTenant!;
    const input = validate.body(createWebhookEndpointSchema, request);
    const secret = input.secret ?? randomBytes(24).toString("base64url");
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        tenantId: ctx.tenantId,
        url: input.url,
        secret,
        events: [...input.events],
      },
    });

    return reply.code(201).send({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      enabled: endpoint.enabled,
      createdAt: endpoint.createdAt.toISOString(),
      secret,
    });
  });

  app.patch("/webhooks/:id", async (request) => {
    const ctx = request.consoleTenant!;
    const { id } = validate.params(idParam, request);
    const input = validate.body(updateWebhookEndpointSchema, request);
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!existing) throw ApiError.notFound("Webhook endpoint not found");

    const endpoint = await prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.events !== undefined ? { events: [...input.events] } : {}),
      },
    });

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      enabled: endpoint.enabled,
      createdAt: endpoint.createdAt.toISOString(),
    };
  });

  app.delete("/webhooks/:id", async (request, reply) => {
    const ctx = request.consoleTenant!;
    const { id } = validate.params(idParam, request);
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!existing) throw ApiError.notFound("Webhook endpoint not found");

    await prisma.webhookEndpoint.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get("/usage", async (request) => {
    const ctx = request.consoleTenant!;
    const summary = await usage.summarizeUsage(ctx.tenantId, startOfMonth());
    const concurrentLive = await usage.countConcurrentLives(ctx.tenantId);
    return {
      liveMinutes: summary.liveMinutes,
      tokensIssued: summary.tokensIssued,
      concurrentLive,
      maxConcurrentLives: ctx.maxConcurrentLives,
      maxMinutesPerMonth: ctx.maxMinutesPerMonth,
    };
  });
}

function startOfMonth(): Date {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart;
}

