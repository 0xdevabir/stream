import { type ChildProcess, spawn } from "node:child_process";

import { env } from "./env";
import type { SourceInfo } from "./ladder";
import { logger, safeUrl } from "./logger";

/** Runs a command to completion and returns its output. */
export function run(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = options.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
      : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
  });
}

/**
 * Inspects the incoming stream before building the ladder.
 *
 * Two facts change the encode: the source height (never upscale) and whether
 * there is an audio track at all (a screen-share publish may have none, and
 * mapping a stream that does not exist makes ffmpeg exit immediately).
 */
export async function probeSource(
  inputUrl: string,
): Promise<SourceInfo | null> {
  const { code, stdout, stderr } = await run(
    env.FFPROBE_PATH,
    [
      "-v",
      "error",
      "-rtsp_transport",
      "tcp",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate",
      "-show_entries",
      "format=nb_streams",
      "-of",
      "json",
      inputUrl,
    ],
    { timeoutMs: 15_000 },
  );

  if (code !== 0) {
    logger.warn(
      { url: safeUrl(inputUrl), stderr: stderr.slice(0, 400) },
      "ffprobe could not read the source",
    );
    return null;
  }

  let parsed: {
    streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string }>;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const video = parsed.streams?.[0];
  if (!video?.width || !video.height) return null;

  // avg_frame_rate arrives as a rational such as "30000/1001".
  const [numerator, denominator] = (video.avg_frame_rate ?? "30/1")
    .split("/")
    .map(Number);
  const fps =
    numerator && denominator ? Math.round(numerator / denominator) : 30;

  const hasAudio = await probeHasAudio(inputUrl);

  return {
    width: video.width,
    height: video.height,
    fps: fps > 0 && fps <= 120 ? fps : 30,
    hasAudio,
  };
}

async function probeHasAudio(inputUrl: string): Promise<boolean> {
  const { code, stdout } = await run(
    env.FFPROBE_PATH,
    [
      "-v",
      "error",
      "-rtsp_transport",
      "tcp",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      inputUrl,
    ],
    { timeoutMs: 15_000 },
  );

  return code === 0 && stdout.trim().length > 0;
}

export interface SupervisedProcess {
  child: ChildProcess;
  /** Resolves with the exit code once the process has fully stopped. */
  done: Promise<number>;
  stop: () => Promise<void>;
}

/**
 * Spawns ffmpeg and gives the caller a graceful way to stop it.
 *
 * SIGTERM first: ffmpeg flushes and closes the current segment cleanly, which
 * matters because a half-written final segment would be a corrupt tail on the
 * recording. SIGKILL only if it refuses to exit.
 */
export function spawnFfmpeg(
  args: string[],
  label: string,
): SupervisedProcess {
  logger.debug({ label, argCount: args.length }, "spawning ffmpeg");

  const child = spawn(env.FFMPEG_PATH, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text.length === 0) return;
    // ffmpeg writes warnings and genuine errors both to stderr; at
    // -loglevel warning anything arriving here is worth surfacing.
    logger.warn({ label }, text.slice(0, 500));
  });

  const done = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? -1));
    child.on("error", (error) => {
      logger.error({ label, err: error.message }, "ffmpeg failed to start");
      resolve(-1);
    });
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    child.kill("SIGTERM");
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 10_000),
    );

    if ((await Promise.race([done, timeout])) === "timeout") {
      logger.warn({ label }, "ffmpeg did not exit on SIGTERM; killing");
      child.kill("SIGKILL");
      await done;
    }
  };

  return { child, done, stop };
}
