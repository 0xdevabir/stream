import { streamIdFromMediamtxPath } from "@stream/shared";
import { z } from "zod";

import { env } from "./env";
import { logger } from "./logger";

/**
 * Discovery of live publishers by polling MediaMTX's control API.
 *
 * MediaMTX can invoke a command on publish (`runOnReady`), but its official
 * image is built FROM scratch and has no shell to run one with. Polling is
 * also simply more robust: it is level-triggered, so a transcoder that crashes
 * and restarts re-discovers every in-progress class on its next tick instead
 * of having missed a one-shot event.
 */

const pathSchema = z.object({
  name: z.string(),
  ready: z.boolean(),
  readyTime: z.string().nullable().optional(),
  source: z.object({ type: z.string(), id: z.string() }).nullable().optional(),
  tracks: z.array(z.string()).default([]),
  bytesReceived: z.number().default(0),
});

const pathListSchema = z.object({
  itemCount: z.number().optional(),
  items: z.array(pathSchema).default([]),
});

export interface LivePath {
  streamId: string;
  tracks: string[];
  readyTime: string | null;
}

/** Stream ids that currently have a publisher connected and ready. */
export async function listLiveStreams(): Promise<LivePath[] | null> {
  let response: Response;
  try {
    response = await fetch(
      `${env.mediamtxApiBase}/v3/paths/list?itemsPerPage=1000`,
      { signal: AbortSignal.timeout(5_000) },
    );
  } catch {
    // MediaMTX restarting is expected; null means "unknown", and callers hold
    // their existing sessions rather than tearing them all down.
    return null;
  }

  if (!response.ok) return null;

  const parsed = pathListSchema.safeParse(await response.json());
  if (!parsed.success) {
    logger.warn("unexpected response from the mediamtx path list");
    return null;
  }

  const live: LivePath[] = [];
  for (const item of parsed.data.items) {
    if (!item.ready || !item.source) continue;

    const streamId = streamIdFromMediamtxPath(item.name);
    if (!streamId) continue;

    live.push({
      streamId,
      tracks: item.tracks,
      readyTime: item.readyTime ?? null,
    });
  }

  return live;
}
