import { z } from "zod";

/**
 * Configuration is validated once, at boot, and the process refuses to start
 * if anything is missing or malformed.
 *
 * This matters more than usual here because several of these values are
 * load-bearing for security: a blank `PLAYBACK_SECRET` would make every
 * playback token forgeable, and a short `CONTENT_KEY_SECRET` would silently
 * weaken every recording's encryption. Failing loudly at startup is far
 * better than discovering either in production.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  /** Origin of the nginx front door. Used for absolute links and cookie flags. */
  PUBLIC_BASE_URL: z.string().url(),

  // ── Secrets ──
  AUTH_SECRET: z.string().min(32),
  PLAYBACK_SECRET: z.string().min(32),
  INTERNAL_TOKEN: z.string().min(16),
  CONTENT_KEY_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (openssl rand -hex 32)"),

  // ── Token lifetimes (seconds) ──
  ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().min(3600).default(2_592_000),
  PLAYBACK_TOKEN_TTL: z.coerce.number().int().min(60).default(3600),
  PUBLISH_TOKEN_TTL: z.coerce.number().int().min(30).default(300),
  MAX_CONCURRENT_SESSIONS_PER_USER: z.coerce.number().int().min(1).default(3),

  // ── Media plane ──
  MEDIAMTX_HOST: z.string().default("mediamtx"),
  MEDIAMTX_API_PORT: z.coerce.number().int().default(9997),
  MEDIAMTX_RTSP_PORT: z.coerce.number().int().default(8554),
  MEDIA_ROOT: z.string().default("/media"),
  LADDER: z.string().default("1080p,720p,480p,360p"),

  /**
   * What instructors paste into OBS. Blank (compose passes "" when unset)
   * falls back to the public hostname, so a customer is never handed a
   * localhost URL they cannot reach.
   */
  INGEST_RTMP_URL: z.string().optional(),
  INGEST_SRT_HOST: z.string().optional(),
  INGEST_SRT_PORT: z.coerce.number().int().default(8890),

  // ── Object storage ──
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;

  // Dev defaults exist so `docker compose up` works on a fresh clone, but
  // shipping them to the internet would be a real vulnerability.
  if (env.NODE_ENV === "production") {
    const placeholders = Object.entries({
      AUTH_SECRET: env.AUTH_SECRET,
      PLAYBACK_SECRET: env.PLAYBACK_SECRET,
      INTERNAL_TOKEN: env.INTERNAL_TOKEN,
      CONTENT_KEY_SECRET: env.CONTENT_KEY_SECRET,
    })
      .filter(([, value]) => /^dev_|^0+$/.test(value))
      .map(([name]) => name);

    if (placeholders.length > 0) {
      throw new Error(
        `Refusing to start in production with development secrets: ${placeholders.join(", ")}. ` +
          "Run: node scripts/gen-secrets.mjs --force",
      );
    }
  }

  const publicHost = new URL(env.PUBLIC_BASE_URL).hostname;
  const ingestRtmpUrl = env.INGEST_RTMP_URL || `rtmp://${publicHost}:1935/live`;
  const ingestSrtHost = env.INGEST_SRT_HOST || publicHost;

  if (env.NODE_ENV === "production" && /localhost|127\.0\.0\.1/.test(ingestRtmpUrl)) {
    console.warn(
      `INGEST_RTMP_URL is ${ingestRtmpUrl}; encoders outside this machine cannot reach it.`,
    );
  }

  return {
    ...env,
    INGEST_RTMP_URL: ingestRtmpUrl.replace(/\/+$/, ""),
    INGEST_SRT_HOST: ingestSrtHost,
    isProduction: env.NODE_ENV === "production",
    /** Cookies get the Secure flag only when the origin can actually use it. */
    cookieSecure: env.PUBLIC_BASE_URL.startsWith("https://"),
    mediamtxApiBase: `http://${env.MEDIAMTX_HOST}:${env.MEDIAMTX_API_PORT}`,
  };
}

export const env = load();
export type Env = typeof env;
