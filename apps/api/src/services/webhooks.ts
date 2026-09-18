import { createHmac, randomBytes } from "node:crypto";

import type { ProviderWebhookEvent } from "@stream/shared";
import { prisma } from "@stream/db";

import { env } from "../env";

/**
 * Fan out provider lifecycle events to tenant webhook endpoints.
 * Delivery is best-effort with a small retry budget; failures are logged in
 * WebhookDelivery rows for the tenant to inspect.
 */
export async function dispatchWebhook(
  tenantId: string,
  eventType: ProviderWebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      tenantId,
      enabled: true,
      events: { has: eventType },
    },
  });

  if (endpoints.length === 0) return;

  const body = JSON.stringify({
    id: randomBytes(12).toString("hex"),
    type: eventType,
    createdAt: new Date().toISOString(),
    data,
  });

  await Promise.all(
    endpoints.map(async (endpoint) => {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventType,
          payload: JSON.parse(body) as object,
          status: "pending",
        },
      });

      try {
        const signature = createHmac("sha256", endpoint.secret)
          .update(body)
          .digest("hex");

        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "stream-provider/0.1",
            "x-stream-event": eventType,
            "x-stream-signature": `sha256=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "delivered",
            attempts: 1,
            deliveredAt: new Date(),
          },
        });
      } catch (error) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "failed",
            attempts: 1,
            lastError:
              error instanceof Error ? error.message.slice(0, 500) : "unknown",
          },
        });
        if (!env.isProduction) {
          console.warn(
            `webhook ${eventType} → ${endpoint.url} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }),
  );
}
