import {
  createLiveInputSchema,
  createPlaybackTokenSchema,
  createWebhookEndpointSchema,
} from "@stream/shared";
import { prisma } from "@stream/db";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import * as liveInputs from "../services/live-inputs";
import {
  type TenantContext,
  requireScope,
  resolveApiKey,
} from "../services/tenants";
import * as usage from "../services/usage";
import * as validate from "../validate";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

const idParam = z.object({ id: z.string().min(1).max(128) });

async function loadTenant(request: FastifyRequest): Promise<void> {
  request.tenant = await resolveApiKey(request.headers.authorization);
}

/**
 * Multi-tenant streaming provider API (Cloudflare Stream–style).
 * Authenticated with `Authorization: Bearer sk_live_...`.
 */
export async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", loadTenant);

  app.post(
    "/live_inputs",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const ctx = request.tenant!;
      requireScope(ctx, "live:write");
      const input = validate.body(createLiveInputSchema, request);
      const { liveInput } = await liveInputs.createLiveInput(ctx, input);
      return reply.code(201).send(liveInput);
    },
  );

  app.get("/live_inputs/:id", async (request) => {
    const ctx = request.tenant!;
    requireScope(ctx, "live:read");
    const { id } = validate.params(idParam, request);
    return liveInputs.getLiveInput(ctx, id);
  });

  app.post(
    "/live_inputs/:id/token",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request) => {
      const ctx = request.tenant!;
      requireScope(ctx, "live:read");
      const { id } = validate.params(idParam, request);
      const body = validate.body(createPlaybackTokenSchema, request);
      return liveInputs.mintPlaybackToken(ctx, id, {
        ttlSeconds: body.ttlSeconds,
      });
    },
  );

  app.delete("/live_inputs/:id", async (request, reply) => {
    const ctx = request.tenant!;
    requireScope(ctx, "live:write");
    const { id } = validate.params(idParam, request);
    await liveInputs.deleteLiveInput(ctx, id);
    return reply.code(204).send();
  });

  app.get("/videos/:id", async (request) => {
    const ctx = request.tenant!;
    requireScope(ctx, "vod:read");
    const { id } = validate.params(idParam, request);
    return liveInputs.getVideo(ctx, id);
  });

  app.get("/usage", async (request) => {
    const ctx = request.tenant!;
    requireScope(ctx, "live:read");

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const summary = await usage.summarizeUsage(ctx.tenantId, monthStart);
    const concurrentLive = await usage.countConcurrentLives(ctx.tenantId);

    return {
      liveMinutes: summary.liveMinutes,
      tokensIssued: summary.tokensIssued,
      concurrentLive,
      maxConcurrentLives: ctx.maxConcurrentLives,
      maxMinutesPerMonth: ctx.maxMinutesPerMonth,
    };
  });

  app.post("/webhooks", async (request, reply) => {
    const ctx = request.tenant!;
    requireScope(ctx, "webhooks:write");
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

  app.get("/webhooks", async (request) => {
    const ctx = request.tenant!;
    requireScope(ctx, "webhooks:write");
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
}
