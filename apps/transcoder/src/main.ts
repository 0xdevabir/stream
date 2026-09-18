import { hostname } from "node:os";

import * as api from "./api";
import { env } from "./env";
import {
  closeLeaseRedis,
  releaseLease,
  renewLease,
  tryAcquireLease,
} from "./lease";
import { logger } from "./logger";
import { listLiveStreams } from "./mediamtx";
import { StreamSession } from "./session";

/**
 * The supervisor.
 *
 * Every tick it asks MediaMTX which classes currently have a publisher, and
 * reconciles that against the sessions it is running: start one for a class
 * that appeared, stop one for a class that went away.
 *
 * When REDIS_URL is set, encode leases ensure only one worker in a pool owns
 * each live input.
 */

const sessions = new Map<string, StreamSession>();
/** Classes whose publisher has vanished, and when we first noticed. */
const missingSince = new Map<string, number>();
/** Classes we tried and failed to start, so we do not thrash on them. */
const backoffUntil = new Map<string, number>();

const workerId = env.workerId;
const leasesEnabled = Boolean(env.REDIS_URL);

let running = true;

async function tick(): Promise<void> {
  const live = await listLiveStreams();

  if (live === null) return;

  const liveIds = new Set(live.map((path) => path.streamId));
  const now = Date.now();

  for (const path of live) {
    if (sessions.has(path.streamId)) {
      missingSince.delete(path.streamId);
      if (leasesEnabled) {
        const ok = await renewLease(path.streamId, workerId);
        if (!ok) {
          logger.warn(
            { streamId: path.streamId },
            "lost encode lease; stopping local session",
          );
          const session = sessions.get(path.streamId);
          sessions.delete(path.streamId);
          if (session) void session.stop();
        }
      }
      continue;
    }

    const backoff = backoffUntil.get(path.streamId);
    if (backoff && now < backoff) continue;

    if (leasesEnabled) {
      const acquired = await tryAcquireLease(path.streamId, workerId);
      if (!acquired) {
        logger.debug(
          { streamId: path.streamId },
          "another worker holds the encode lease",
        );
        continue;
      }
    }

    const session = new StreamSession(path.streamId);
    sessions.set(path.streamId, session);

    try {
      const started = await session.start();
      if (!started) {
        sessions.delete(path.streamId);
        if (leasesEnabled) await releaseLease(path.streamId, workerId);
        backoffUntil.set(path.streamId, Date.now() + 5_000);
      } else {
        backoffUntil.delete(path.streamId);
        logger.info(
          { streamId: path.streamId, workerId },
          "encode session started",
        );
      }
    } catch (error) {
      logger.error(
        {
          streamId: path.streamId,
          err: error instanceof Error ? error.message : String(error),
        },
        "failed to start session",
      );
      sessions.delete(path.streamId);
      if (leasesEnabled) await releaseLease(path.streamId, workerId);
      backoffUntil.set(path.streamId, Date.now() + 15_000);
    }
  }

  for (const [streamId, session] of sessions) {
    if (liveIds.has(streamId)) continue;

    const since = missingSince.get(streamId);
    if (since === undefined) {
      missingSince.set(streamId, now);
      logger.info({ streamId }, "publisher gone; waiting to see if it returns");
      continue;
    }

    if (now - since < env.SOURCE_GRACE_MS) continue;

    missingSince.delete(streamId);
    sessions.delete(streamId);

    void session
      .stop()
      .catch((error) => {
        logger.error(
          {
            streamId,
            err: error instanceof Error ? error.message : String(error),
          },
          "failed to stop session cleanly",
        );
      })
      .finally(() => {
        if (leasesEnabled) void releaseLease(streamId, workerId);
      });
  }
}

async function heartbeat(): Promise<void> {
  await Promise.all(
    [...sessions.keys()].map((streamId) => api.reportHeartbeat(streamId)),
  );
}

async function main(): Promise<void> {
  logger.info(
    {
      mediamtx: env.mediamtxApiBase,
      mediaRoot: env.MEDIA_ROOT,
      ladder: env.LADDER,
      encoder: env.VIDEO_ENCODER,
      segmentSeconds: env.HLS_SEGMENT_SECONDS,
      workerId,
      leases: leasesEnabled,
      host: hostname(),
    },
    "transcoder started",
  );

  const shutdown = async (signal: string) => {
    if (!running) return;
    running = false;

    logger.info({ signal, sessions: sessions.size }, "shutting down");

    await Promise.allSettled(
      [...sessions.entries()].map(async ([streamId, session]) => {
        await session.stop();
        if (leasesEnabled) await releaseLease(streamId, workerId);
      }),
    );
    await closeLeaseRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const heartbeatTimer = setInterval(() => void heartbeat(), 15_000);
  heartbeatTimer.unref();

  while (running) {
    try {
      await tick();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "reconciliation tick failed",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, env.POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  logger.fatal({ err: error }, "transcoder crashed");
  process.exit(1);
});
