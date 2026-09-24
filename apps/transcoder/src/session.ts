import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Rendition, keyUrl, parseLadder } from "@stream/shared";
import {
  keyFilePath,
  keyInfoFilePath,
  liveDir,
  liveMasterPath,
  liveRenditionDir,
} from "@stream/shared";

import * as api from "./api";
import { env } from "./env";
import { type SupervisedProcess, probeSource, spawnFfmpeg } from "./ffmpeg";
import {
  type SourceInfo,
  buildFfmpegArgs,
  buildKeyInfo,
  deriveIv,
  buildMasterPlaylist,
  outputFps,
  selectRenditions,
} from "./ladder";
import { logger } from "./logger";
import { cleanupLiveDirectory, finalizeRecording, reportFinalized } from "./finalize";
import { VodRecorder } from "./vod-recorder";

const THUMBNAIL_INTERVAL_SECONDS = 30;

/**
 * How long an encode must survive before we consider it healthy and forgive
 * the earlier failures. Long enough to be past startup, short enough that a
 * class dropping every couple of minutes still trips the crash-loop guard.
 */
const STABLE_ENCODE_MS = 30_000;

/** Consecutive near-instant failures tolerated before abandoning a class. */
const MAX_RAPID_RESTARTS = 8;

type State = "starting" | "running" | "stopping" | "stopped";

/**
 * One live class, from first frame to published replay.
 *
 * The session owns the ffmpeg process, the VOD recorder tailing its playlists,
 * and the transition into the recording pipeline when the source disappears.
 * It is deliberately self-contained: the supervisor only starts and stops it.
 */
export class StreamSession {
  private state: State = "starting";
  private ffmpeg: SupervisedProcess | null = null;
  private recorder: VodRecorder | null = null;
  private renditions: Rendition[] = [];
  private source: SourceInfo | null = null;
  /** The encoded frame rate, which the playlists and replay must agree on. */
  private get fps(): number {
    return outputFps(this.source ?? { fps: 30 }, env.MAX_FPS);
  }
  private recordingId: string | null = null;
  /** Consecutive rapid ffmpeg failures; reset once an encode proves stable. */
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private inputUrl = "";
  /**
   * True while the publisher is away. The class stays open -- same session,
   * same recording -- but there is nothing to encode, so ffmpeg is parked
   * rather than left to crash-loop against an empty path.
   */
  private paused = false;
  /** Resolves once the ffmpeg being parked has flushed and exited. */
  private parking: Promise<void> = Promise.resolve();

  private readonly log;

  constructor(readonly streamId: string) {
    this.log = logger.child({ streamId });
  }

  isRunning(): boolean {
    return this.state === "starting" || this.state === "running";
  }

  isStopped(): boolean {
    return this.state === "stopped";
  }

  /**
   * The publisher dropped (network blip, OBS reconnecting, a browser redial).
   *
   * Previously ffmpeg was simply left to exit and respawn against a path with
   * nothing on it. Every one of those instant failures counted towards the
   * crash-loop limit, so a gap of about a minute exhausted it, the session
   * gave up, and the class ended even though the instructor came back.
   */
  sourceLost(): void {
    if (this.state !== "running" || this.paused) return;
    this.paused = true;
    this.clearRestartTimer();
    this.parking = this.ffmpeg?.stop() ?? Promise.resolve();
  }

  /** The publisher is back within the grace period: carry on where we left off. */
  sourceReturned(): void {
    if (this.state !== "running" || !this.paused) return;
    this.paused = false;
    this.restarts = 0;
    this.clearRestartTimer();
    this.log.info("publisher returned; resuming encode");

    // Two ffmpeg processes appending to one playlist would corrupt it, so the
    // parked one must be fully gone first.
    void this.parking.then(() => {
      if (this.state === "running" && !this.paused) this.spawn(this.inputUrl);
    });
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  async start(): Promise<boolean> {
    const config = await api.getEncodeConfig(this.streamId);
    if (!config) {
      this.log.warn("no encode config; ignoring this publisher");
      this.state = "stopped";
      return false;
    }

    const inputUrl = env.rtspUrl(this.streamId);
    this.inputUrl = inputUrl;

    const source = await probeSource(inputUrl);
    if (!source) {
      this.log.warn("could not probe the source; will retry on the next tick");
      this.state = "stopped";
      return false;
    }
    this.source = source;

    this.renditions = selectRenditions(parseLadder(config.ladder.join(",")), source);
    this.log.info(
      {
        source: `${source.width}x${source.height}@${source.fps}`,
        renditions: this.renditions.map((r) => r.name),
        audio: source.hasAudio,
      },
      "starting encode",
    );

    await this.prepareDirectories();
    await this.writeKeyMaterial(config);
    await this.writeMasterPlaylist();

    this.recorder = new VodRecorder(this.streamId, this.renditions);
    this.recorder.start();

    this.spawn(inputUrl);
    this.state = "running";

    await api.reportLive(this.streamId);

    if (config.recordEnabled) {
      this.recordingId = await api.startRecording(this.streamId);
    }

    return true;
  }

  private async prepareDirectories(): Promise<void> {
    const base = liveDir(env.MEDIA_ROOT, this.streamId);

    // A previous run of the same class would leave stale segments whose
    // sequence numbers overlap the new ones, corrupting both the live window
    // and the recording.
    await rm(base, { recursive: true, force: true });

    await mkdir(join(base, "thumbs"), { recursive: true });
    await mkdir(join(env.MEDIA_ROOT, "keys"), { recursive: true });

    for (const rendition of this.renditions) {
      await mkdir(liveRenditionDir(env.MEDIA_ROOT, this.streamId, rendition.name), {
        recursive: true,
      });
    }
  }

  private async writeKeyMaterial(config: api.EncodeConfig): Promise<void> {
    const keyPath = keyFilePath(env.MEDIA_ROOT, this.streamId);
    const infoPath = keyInfoFilePath(env.MEDIA_ROOT, this.streamId);

    // The raw 16 key bytes, readable only by this container: /media/keys is
    // never exposed by the edge, which serves /media/live only.
    await writeFile(keyPath, Buffer.from(config.contentKeyHex, "hex"), {
      mode: 0o600,
    });
    await writeFile(
      infoPath,
      buildKeyInfo(
        keyUrl(config.contentKeyId),
        keyPath,
        deriveIv(config.contentKeyHex, this.streamId),
      ),
      { mode: 0o600 },
    );
  }

  private async writeMasterPlaylist(): Promise<void> {
    await writeFile(
      liveMasterPath(env.MEDIA_ROOT, this.streamId),
      buildMasterPlaylist(this.renditions, { fps: this.fps }),
      "utf8",
    );
  }

  private spawn(inputUrl: string): void {
    const args = buildFfmpegArgs({
      inputUrl,
      outputDir: liveDir(env.MEDIA_ROOT, this.streamId),
      keyInfoPath: keyInfoFilePath(env.MEDIA_ROOT, this.streamId),
      renditions: this.renditions,
      segmentSeconds: env.HLS_SEGMENT_SECONDS,
      listSize: env.HLS_LIST_SIZE,
      encoder: env.VIDEO_ENCODER,
      preset: env.X264_PRESET,
      rateControl: env.RATE_CONTROL,
      quality: env.VIDEO_QUALITY,
      hwDevice: env.HW_DEVICE,
      source: this.source!,
      fps: this.fps,
      thumbnailDir: join(liveDir(env.MEDIA_ROOT, this.streamId), "thumbs"),
      thumbnailIntervalSeconds: THUMBNAIL_INTERVAL_SECONDS,
    });

    const spawnedAt = Date.now();
    this.ffmpeg = spawnFfmpeg(args, this.streamId);

    void this.ffmpeg.done.then((code) => {
      // A parked encoder exiting is expected, not a failure.
      if (this.state !== "running" || this.paused) return;

      // An encode that ran for a good while and *then* exited is a fresh
      // incident, not a continuing failure. Counting restarts cumulatively
      // over a whole class would guarantee that any sufficiently long lecture
      // eventually hits the cap and gets killed while perfectly healthy.
      if (Date.now() - spawnedAt >= STABLE_ENCODE_MS) this.restarts = 0;

      // The bound that remains is only against a tight crash loop: a source
      // ffmpeg cannot read at all must not become a spawn storm.
      if (this.restarts < MAX_RAPID_RESTARTS) {
        this.restarts += 1;
        const delay = Math.min(1_000 * 2 ** (this.restarts - 1), 15_000);
        this.log.warn(
          { code, attempt: this.restarts, retryInMs: delay },
          "ffmpeg exited; restarting",
        );
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.state === "running" && !this.paused) this.spawn(inputUrl);
        }, delay);
      } else {
        this.log.error(
          { code },
          "ffmpeg keeps exiting immediately; giving up on this class",
        );
        void this.stop();
      }
    });
  }

  /**
   * Called when the publisher disconnects, or on shutdown.
   *
   * Everything after stopping ffmpeg is the recording pipeline, which must run
   * to completion even though the class is over -- that is what a student
   * looking for the replay tomorrow depends on.
   */
  async stop(): Promise<void> {
    if (this.state === "stopping" || this.state === "stopped") return;
    this.state = "stopping";
    this.clearRestartTimer();

    this.log.info("stopping encode");
    await this.ffmpeg?.stop();

    await api.reportOffline(this.streamId);

    if (this.recorder && this.recordingId) {
      const result = await finalizeRecording({
        streamId: this.streamId,
        recordingId: this.recordingId,
        renditions: this.renditions,
        recorder: this.recorder,
        fps: this.fps,
      });

      await reportFinalized(this.recordingId, result);

      // Only reclaim the disk once the replay is safely in object storage.
      if (result.status === "READY") {
        await cleanupLiveDirectory(this.streamId);
      } else {
        this.log.error(
          { error: result.error },
          "recording failed; keeping local media for recovery",
        );
      }
    } else {
      await this.recorder?.stop();
      await cleanupLiveDirectory(this.streamId);
    }

    this.state = "stopped";
    this.log.info("session finished");
  }
}
