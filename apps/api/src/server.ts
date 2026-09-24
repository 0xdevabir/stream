import { disconnect } from "@stream/db";

import { buildApp } from "./app";
import { env } from "./env";
import { closeRedis } from "./redis";
import { startDispatcher, stopDispatcher } from "./services/webhooks";

async function main(): Promise<void> {
  const app = await buildApp();

  // Docker sends SIGTERM and waits ~10s before SIGKILL. Draining in-flight
  // requests matters here because a hard kill mid-response shows up to a
  // student as a stalled player.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, "shutting down");
    stopDispatcher();
    try {
      await app.close();
      await Promise.allSettled([disconnect(), closeRedis()]);
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "failed to shut down cleanly");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  startDispatcher(app.log);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
