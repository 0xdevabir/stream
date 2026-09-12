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
  buildMasterPlaylist,
  selectRenditions,
} from "./ladder";
import { logger } from "./logger";
import { cleanupLiveDirectory, finalizeRecording, reportFinalized } from "./finalize";
import { VodRecorder } from "./vod-recorder";

const THUMBNAIL_INTERVAL_SECONDS = 30;

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
  private recordingId: string | null = null;
  private restarts = 0;

  private readonly log;

  constructor(readonly streamId: string) {
    this.log = logger.child({ streamId });
  }

  isRunning(): boolean {
    return this.state === "starting" || this.state === "running";
  }

  async start(): Promise<boolean> {
    const config = await api.getEncodeConfig(this.streamId);
    if (!config) {
      this.log.warn("no encode config; ignoring this publisher");
      this.state = "stopped";
      return false;
    }

    const inputUrl = env.rtspUrl(this.streamId);

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
      buildKeyInfo(keyUrl(config.contentKeyId), keyPath),
      { mode: 0o600 },
    );
  }

  private async writeMasterPlaylist(): Promise<void> {
    await writeFile(
      liveMasterPath(env.MEDIA_ROOT, this.streamId),
      buildMasterPlaylist(this.renditions, { fps: this.source?.fps ?? 30 }),
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
      source: this.source!,
      thumbnailDir: join(liveDir(env.MEDIA_ROOT, this.streamId), "thumbs"),
      thumbnailIntervalSeconds: THUMBNAIL_INTERVAL_SECONDS,
    });

    this.ffmpeg = spawnFfmpeg(args, this.streamId);

    void this.ffmpeg.done.then((code) => {
      if (this.state !== "running") return;

      // ffmpeg exiting while the publisher is still connected means it
      // crashed or lost the RTSP pull. Relaunch, but bounded: a source that
      // consistently kills the encoder must not become a spawn loop.
      if (this.restarts < 3) {
        this.restarts += 1;
        this.log.warn({ code, attempt: this.restarts }, "ffmpeg exited; restarting");
        setTimeout(() => {
          if (this.state === "running") this.spawn(inputUrl);
        }, 1_000);
      } else {
        this.log.error({ code }, "ffmpeg keeps exiting; giving up on this class");
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

    this.log.info("stopping encode");
    await this.ffmpeg?.stop();

    await api.reportOffline(this.streamId);

    if (this.recorder && this.recordingId) {
      const result = await finalizeRecording({
        streamId: this.streamId,
        recordingId: this.recordingId,
        renditions: this.renditions,
        recorder: this.recorder,
        fps: this.source?.fps ?? 30,
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
