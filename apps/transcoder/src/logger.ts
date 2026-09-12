import pino from "pino";

import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "production"
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
  // The RTSP pull URL embeds INTERNAL_TOKEN, and ffmpeg command lines are
  // logged at debug level, so scrub anything that looks like credentials.
  redact: {
    paths: ["url", "args", "command"],
    censor: "[redacted]",
  },
});

/** Removes inline credentials before a URL reaches a log line or an error. */
export function safeUrl(url: string): string {
  return url.replace(/\/\/[^@/]+@/, "//***@");
}
