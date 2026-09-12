import * as api from "./api";
import { env } from "./env";
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
 * Reconciliation rather than event handling is a deliberate choice. It is
 * level-triggered, so a transcoder that crashes mid-class picks the class back
 * up on its next tick instead of leaving it permanently unencoded, and there
 * is no event queue to get out of sync with reality.
 */

const sessions = new Map<string, StreamSession>();
/** Classes whose publisher has vanished, and when we first noticed. */
const missingSince = new Map<string, number>();
/** Classes we tried and failed to start, so we do not thrash on them. */
const backoffUntil = new Map<string, number>();

let running = true;

async function tick(): Promise<void> {
  const live = await listLiveStreams();

  // null means MediaMTX is unreachable, not that every class ended. Tearing
  // down running sessions here would kill live classes over a blip.
  if (live === null) return;

  const liveIds = new Set(live.map((path) => path.streamId));
  const now = Date.now();

  for (const path of live) {
    if (sessions.has(path.streamId)) {
      missingSince.delete(path.streamId);
      continue;
    }

    const backoff = backoffUntil.get(path.streamId);
    if (backoff && now < backoff) continue;

    const session = new StreamSession(path.streamId);
    sessions.set(path.streamId, session);

    try {
      const started = await session.start();
      if (!started) {
        sessions.delete(path.streamId);
        // Usually a publisher for a class that does not exist, or a source
        // that is not yet producing frames.
        backoffUntil.set(path.streamId, Date.now() + 5_000);
      } else {
        backoffUntil.delete(path.streamId);
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
      backoffUntil.set(path.streamId, Date.now() + 15_000);
    }
  }

  for (const [streamId, session] of sessions) {
    if (liveIds.has(streamId)) continue;

    // An encoder that drops for a few seconds (a laptop changing networks,
    // OBS reconnecting) should not end the class and trigger a recording.
    const since = missingSince.get(streamId);
    if (since === undefined) {
      missingSince.set(streamId, now);
      logger.info({ streamId }, "publisher gone; waiting to see if it returns");
      continue;
    }

    if (now - since < env.SOURCE_GRACE_MS) continue;

    missingSince.delete(streamId);
    sessions.delete(streamId);

    // Finalizing uploads a whole class and can take a while; it must not
    // block the next reconciliation tick.
    void session.stop().catch((error) => {
      logger.error(
        {
          streamId,
          err: error instanceof Error ? error.message : String(error),
        },
        "failed to stop session cleanly",
      );
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
    },
    "transcoder started",
  );

  const shutdown = async (signal: string) => {
    if (!running) return;
    running = false;

    logger.info({ signal, sessions: sessions.size }, "shutting down");

    // Stop every class properly so in-progress recordings still get published.
    await Promise.allSettled(
      [...sessions.values()].map((session) => session.stop()),
    );
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
