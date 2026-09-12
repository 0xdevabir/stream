import { z } from "zod";

import { env } from "./env";
import { logger } from "./logger";

/**
 * Client for the API's internal control plane.
 *
 * The transcoder deliberately owns no database credentials -- it runs ffmpeg
 * against media it did not produce, which makes it the component most worth
 * isolating. Everything it needs about a class, including the AES content key,
 * it asks for here over the compose network with a shared secret.
 */

const encodeConfigSchema = z.object({
  streamId: z.string(),
  title: z.string(),
  recordEnabled: z.boolean(),
  latencyMode: z.enum(["LOW", "ULTRA"]),
  contentKeyId: z.string(),
  contentKeyHex: z.string().regex(/^[0-9a-f]{32}$/i),
  ladder: z.array(z.string()),
});

export type EncodeConfig = z.infer<typeof encodeConfigSchema>;

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  try {
    return await fetch(`${env.API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "x-internal-token": env.INTERNAL_TOKEN,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    logger.warn(
      { path, err: error instanceof Error ? error.message : String(error) },
      "api request failed",
    );
    return null;
  }
}

export async function getEncodeConfig(
  streamId: string,
): Promise<EncodeConfig | null> {
  const response = await request(`/internal/streams/${streamId}/encode-config`);
  if (!response?.ok) {
    if (response) {
      logger.warn({ streamId, status: response.status }, "no encode config");
    }
    return null;
  }

  const parsed = encodeConfigSchema.safeParse(await response.json());
  if (!parsed.success) {
    logger.error({ streamId }, "encode config failed validation");
    return null;
  }
  return parsed.data;
}

export async function reportLive(streamId: string): Promise<void> {
  await request(`/internal/streams/${streamId}/live`, { method: "POST" });
}

export async function reportOffline(streamId: string): Promise<void> {
  await request(`/internal/streams/${streamId}/offline`, { method: "POST" });
}

export async function reportHeartbeat(streamId: string): Promise<void> {
  await request(`/internal/streams/${streamId}/heartbeat`, { method: "POST" });
}

export async function startRecording(streamId: string): Promise<string | null> {
  const response = await request("/internal/recordings/start", {
    method: "POST",
    body: JSON.stringify({ streamId }),
  });
  if (!response?.ok) return null;

  const parsed = z
    .object({ recordingId: z.string() })
    .safeParse(await response.json());
  return parsed.success ? parsed.data.recordingId : null;
}

export interface CompleteRecordingInput {
  recordingId: string;
  status: "READY" | "FAILED";
  durationSeconds?: number;
  sizeBytes?: number;
  segmentCount?: number;
  renditions?: string[];
  storagePrefix?: string;
  posterKey?: string;
  downloadKey?: string;
  error?: string;
}

export async function completeRecording(
  input: CompleteRecordingInput,
): Promise<void> {
  await request("/internal/recordings/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
