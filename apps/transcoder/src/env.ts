import { z } from "zod";

/**
 * Transcoder configuration.
 *
 * This process holds no database credentials by design: everything it needs
 * about a class -- including the AES content key -- it asks the API for over
 * the internal network. That keeps the component with the largest attack
 * surface (it runs ffmpeg against untrusted media) away from Postgres.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  API_BASE_URL: z.string().url().default("http://api:4000"),
  INTERNAL_TOKEN: z.string().min(16),

  MEDIAMTX_HOST: z.string().default("mediamtx"),
  MEDIAMTX_API_PORT: z.coerce.number().int().default(9997),
  MEDIAMTX_RTSP_PORT: z.coerce.number().int().default(8554),

  MEDIA_ROOT: z.string().default("/media"),
  LADDER: z.string().default("1080p,720p,480p,360p"),

  VIDEO_ENCODER: z
    .enum(["libx264", "h264_nvenc", "h264_vaapi"])
    .default("libx264"),
  X264_PRESET: z.string().default("veryfast"),

  HLS_SEGMENT_SECONDS: z.coerce.number().min(0.5).max(10).default(1),
  HLS_LIST_SIZE: z.coerce.number().int().min(3).max(60).default(8),

  /** How often to ask MediaMTX which paths have a publisher. */
  POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(10_000).default(1_000),
  /** Give a reconnecting encoder this long before tearing the session down. */
  /**
   * How long a class survives with no publisher before it is finalized.
   *
   * This is the "did the lecturer's wifi blip, or did the class actually end?"
   * threshold. Erring short is expensive and irreversible -- it ends the class,
   * publishes a truncated recording, and the instructor has to start over --
   * whereas erring long only delays the replay by a few seconds. Hence a
   * generous default; ending a class deliberately goes through "End class",
   * which does not wait for this.
   */
  SOURCE_GRACE_MS: z.coerce.number().int().min(0).max(600_000).default(45_000),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid transcoder configuration:\n${details}`);
  }

  const env = parsed.data;

  return {
    ...env,
    mediamtxApiBase: `http://${env.MEDIAMTX_HOST}:${env.MEDIAMTX_API_PORT}`,
    /**
     * RTSP pull URL for a class. The `internal` user plus INTERNAL_TOKEN is
     * what MediaMTX's auth hook recognises as this service rather than a
     * viewer, in `apps/api/src/routes/internal.ts`.
     */
    rtspUrl(streamId: string): string {
      const credentials = `internal:${encodeURIComponent(env.INTERNAL_TOKEN)}`;
      return `rtsp://${credentials}@${env.MEDIAMTX_HOST}:${env.MEDIAMTX_RTSP_PORT}/live/${streamId}`;
    },
  };
}

export const env = load();
export type Env = typeof env;
