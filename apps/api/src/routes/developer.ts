import {
  createApiKeySchema,
  createWebhookSchema,
  idSchema,
  updateWebhookSchema,
} from "@stream/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { rejectApiKey, requireRole } from "../auth/session";
import * as apiKeys from "../services/api-keys";
import * as webhooks from "../services/webhooks";
import * as validate from "../validate";

const idParam = z.object({ id: idSchema });
const deliveryParam = z.object({ id: idSchema, deliveryId: idSchema });

/**
 * Credential management for the developer API: organization API keys and
 * webhook endpoints. Admins only, and only from a signed-in browser session --
 * an API key can never mint keys or read webhook configuration, so a leaked
 * key stays revocable.
 */
export async function developerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", rejectApiKey);

  // ── API keys ─────────────────────────────────────────────────────────────

  app.get("/api-keys", async (request) => {
    const auth = requireRole(request, "ADMIN");
    return { items: await apiKeys.listApiKeys(auth.organizationId) };
  });

  app.post("/api-keys", async (request, reply) => {
    const auth = requireRole(request, "ADMIN");
    const input = validate.body(createApiKeySchema, request);
    const created = await apiKeys.createApiKey(auth.organizationId, auth.userId, input.name);
    return reply.code(201).send(created);
  });

  app.delete("/api-keys/:id", async (request, reply) => {
    const auth = requireRole(request, "ADMIN");
    const { id } = validate.params(idParam, request);
    await apiKeys.revokeApiKey(auth.organizationId, id);
    return reply.code(204).send();
  });

  // ── Webhooks ─────────────────────────────────────────────────────────────

  app.get("/webhooks", async (request) => {
    const auth = requireRole(request, "ADMIN");
    return { items: await webhooks.listWebhooks(auth.organizationId) };
  });

  app.post("/webhooks", async (request, reply) => {
    const auth = requireRole(request, "ADMIN");
    const input = validate.body(createWebhookSchema, request);
    const created = await webhooks.createWebhook(auth.organizationId, input);
    return reply.code(201).send(created);
  });

  app.patch("/webhooks/:id", async (request) => {
    const auth = requireRole(request, "ADMIN");
    const { id } = validate.params(idParam, request);
    const input = validate.body(updateWebhookSchema, request);
    return webhooks.updateWebhook(auth.organizationId, id, input);
  });

  app.delete("/webhooks/:id", async (request, reply) => {
    const auth = requireRole(request, "ADMIN");
    const { id } = validate.params(idParam, request);
    await webhooks.deleteWebhook(auth.organizationId, id);
    return reply.code(204).send();
  });

  app.post(
    "/webhooks/:id/test",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const auth = requireRole(request, "ADMIN");
      const { id } = validate.params(idParam, request);
      return reply.code(202).send(await webhooks.sendTestEvent(auth.organizationId, id));
    },
  );

  app.get("/webhooks/:id/deliveries", async (request) => {
    const auth = requireRole(request, "ADMIN");
    const { id } = validate.params(idParam, request);
    return { items: await webhooks.listDeliveries(auth.organizationId, id) };
  });

  app.post("/webhooks/:id/deliveries/:deliveryId/retry", async (request, reply) => {
    const auth = requireRole(request, "ADMIN");
    const { id, deliveryId } = validate.params(deliveryParam, request);
    await webhooks.retryDelivery(auth.organizationId, id, deliveryId);
    return reply.code(202).send();
  });
}
