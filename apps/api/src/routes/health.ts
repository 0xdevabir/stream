import { pingDatabase } from "@stream/db";
import type { FastifyInstance } from "fastify";

import { pingRedis } from "../redis";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Liveness. Deliberately checks nothing external: if Postgres is down we
   * want the container restarted only if *it* is broken, not if a dependency
   * is, otherwise a brief database blip turns into a restart storm.
   */
  app.get("/healthz", async () => ({ status: "ok" }));

  /** Readiness. Used by the compose healthcheck and any load balancer. */
  app.get("/readyz", async (_request, reply) => {
    const [database, cache] = await Promise.all([pingDatabase(), pingRedis()]);
    const ready = database && cache;

    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "degraded",
      checks: { database, redis: cache },
    });
  });

  /**
   * Lightweight observability for the control plane. Safe to scrape; does not
   * expose secrets. Encode health lives in transcoder logs + MediaMTX.
   */
  app.get("/metrics", async () => {
    const { prisma } = await import("@stream/db");
    const [live, processing, tenants, deliveriesFailed] = await Promise.all([
      prisma.stream.count({ where: { status: "LIVE" } }),
      prisma.stream.count({ where: { status: "PROCESSING" } }),
      prisma.tenant.count(),
      prisma.webhookDelivery.count({
        where: {
          status: "failed",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
      }),
    ]);

    return {
      streams: { live, processing },
      tenants,
      webhooksFailed24h: deliveriesFailed,
      ts: new Date().toISOString(),
    };
  });
}

