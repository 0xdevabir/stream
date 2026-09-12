import { mediamtxPath } from "@stream/shared";

import { env } from "../env";

/**
 * Client for MediaMTX's control API.
 *
 * The API only needs two things from it: whether a publisher is currently
 * connected, and the ability to forcibly disconnect one when an instructor
 * ends a class or a stream key is rotated mid-broadcast. Discovering new
 * publishers is the transcoder's job, not this one's.
 */

interface PathSource {
  type: string;
  id: string;
}

interface PathItem {
  name: string;
  ready: boolean;
  readyTime: string | null;
  source: PathSource | null;
  tracks: string[];
  bytesReceived: number;
}

interface PathList {
  itemCount: number;
  pageCount: number;
  items: PathItem[];
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  try {
    const response = await fetch(`${env.mediamtxApiBase}${path}`, {
      ...init,
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    if (response.status === 204) return null;

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    // MediaMTX being briefly unreachable must not fail an API request; the
    // caller treats null as "unknown" and carries on.
    return null;
  }
}

export async function getPath(streamId: string): Promise<PathItem | null> {
  return request<PathItem>(
    `/v3/paths/get/${encodeURIComponent(mediamtxPath(streamId))}`,
  );
}

export async function isPublishing(streamId: string): Promise<boolean> {
  const path = await getPath(streamId);
  return path?.ready === true && path.source !== null;
}

export async function listPaths(): Promise<PathItem[]> {
  const list = await request<PathList>("/v3/paths/list?itemsPerPage=1000");
  return list?.items ?? [];
}

/** Maps a MediaMTX source type onto the endpoint that can disconnect it. */
const KICK_ENDPOINTS: Record<string, string> = {
  rtmpConn: "rtmpconns",
  srtConn: "srtconns",
  webRTCSession: "webrtcsessions",
  rtspSession: "rtspsessions",
  rtspsSession: "rtspsessions",
};

/**
 * Disconnects whoever is currently publishing a stream.
 *
 * Used by the "End class" button and by stream-key rotation. Returns false
 * when nobody was publishing, which the caller treats as success -- the
 * desired end state is "no publisher", and it is already true.
 */
export async function kickPublisher(streamId: string): Promise<boolean> {
  const path = await getPath(streamId);
  if (!path?.source) return false;

  const endpoint = KICK_ENDPOINTS[path.source.type];
  if (!endpoint) return false;

  await request(
    `/v3/${endpoint}/kick/${encodeURIComponent(path.source.id)}`,
    { method: "POST" },
  );
  return true;
}
