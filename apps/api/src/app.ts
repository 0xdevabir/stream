import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import { loadSession, verifyCsrf } from "./auth/session";
import { env } from "./env";
import { registerErrorHandler } from "./errors";
import { redis } from "./redis";
import { authRoutes } from "./routes/auth";
import { consoleRoutes } from "./routes/console";
import { healthRoutes } from "./routes/health";
import { internalRoutes } from "./routes/internal";
import { keyRoutes } from "./routes/keys";
import { playbackRoutes } from "./routes/playback";
import { providerRoutes } from "./routes/provider";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.isProduction
        ? {}
        : { transport: { target: "pino-pretty", options: { colorize: true } } }),
    },
    // The edge terminates TLS and is the only thing that talks to us, so its
    // X-Forwarded-* headers are the source of truth for scheme and client IP.
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  registerErrorHandler(app);

  await app.register(helmet, {
    // The web app is served by Next.js through the same origin and manages its
    // own CSP; a second policy here would only conflict with it.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  });

  await app.register(cookie, { secret: env.AUTH_SECRET });

  await app.register(rateLimit, {
    // Off by default: media traffic is high-volume by design.
    // Limits are applied per-route where abuse actually matters (login,
    // playback grants, key fetches).
    global: false,
    redis,
    nameSpace: "rl:",
  });

  await app.register(healthRoutes);

  // Service-to-service. Authenticated by INTERNAL_TOKEN, no cookies, and
  // blocked at the edge -- so it is deliberately outside the CSRF scope.
  await app.register(internalRoutes, { prefix: "/internal" });

  await app.register(
    async (scope) => {
      scope.addHook("onRequest", loadSession);
      scope.addHook("preHandler", verifyCsrf);

      await scope.register(authRoutes, { prefix: "/auth" });
      await scope.register(consoleRoutes, { prefix: "/console" });
      await scope.register(providerRoutes, { prefix: "/provider" });
      // Same-origin playback cookie grants (optional; LMS uses signed tokens).
      await scope.register(playbackRoutes, { prefix: "/streams" });
      await scope.register(keyRoutes, { prefix: "/keys" });
    },
    { prefix: "/v1" },
  );

  return app;
}
