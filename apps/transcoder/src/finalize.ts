import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Rendition } from "@stream/shared";
import {
  keyFilePath,
  liveDir,
  liveRenditionDir,
  vodObjectKey,
  vodObjectPrefix,
  vodVariantPlaylistPath,
} from "@stream/shared";

import * as api from "./api";
import { env } from "./env";
import { run } from "./ffmpeg";
import { buildMasterPlaylist } from "./ladder";
import { logger } from "./logger";
import { rewriteKeyUri } from "./playlist";
import { uploadAll, uploadText } from "./storage";
import type { VodRecorder } from "./vod-recorder";

/**
 * Turns a finished live class into a published replay.
 *
 * The defining property of this step is that it does **not re-encode**. The
 * encrypted segments ffmpeg wrote during the class are the exact bytes the
 * replay serves; all that is produced fresh is a set of VOD playlists, a
 * poster frame, and a progressive MP4 remuxed with `-c copy`. That is what
 * keeps recording essentially free -- the alternative, a second encode pass
 * per class, would roughly double the CPU bill.
 */

export interface FinalizeResult {
  status: "READY" | "FAILED";
  durationSeconds: number;
  sizeBytes: number;
  segmentCount: number;
  renditions: string[];
  storagePrefix: string;
  posterKey?: string;
  downloadKey?: string;
  error?: string;
}

export async function finalizeRecording(options: {
  streamId: string;
  recordingId: string;
  renditions: Rendition[];
  recorder: VodRecorder;
  fps: number;
}): Promise<FinalizeResult> {
  const { streamId, recordingId, recorder } = options;
  const prefix = vodObjectPrefix(recordingId);
  const log = logger.child({ streamId, recordingId });

  try {
    const summary = await recorder.finalize();

    if (summary.renditions.length === 0) {
      return {
        status: "FAILED",
        durationSeconds: 0,
        sizeBytes: 0,
        segmentCount: 0,
        renditions: [],
        storagePrefix: prefix,
        error: "No segments were captured for any rendition",
      };
    }

    const published = options.renditions.filter((rendition) =>
      summary.renditions.includes(rendition.name),
    );

    // The replay's multivariant playlist points at vod.m3u8 rather than the
    // live index.m3u8.
    const master = buildMasterPlaylist(published, {
      variantPlaylistName: "vod.m3u8",
      fps: options.fps,
    });

    const uploads: Array<{ localPath: string; key: string }> = [];

    for (const rendition of published) {
      const directory = liveRenditionDir(env.MEDIA_ROOT, streamId, rendition.name);

      uploads.push({
        localPath: vodVariantPlaylistPath(env.MEDIA_ROOT, streamId, rendition.name),
        key: vodObjectKey(recordingId, `${rendition.name}/vod.m3u8`),
      });

      const entries = await readdir(directory);
      for (const entry of entries) {
        if (!entry.endsWith(".ts")) continue;
        uploads.push({
          localPath: join(directory, entry),
          key: vodObjectKey(recordingId, `${rendition.name}/${entry}`),
        });
      }
    }

    const posterKey = await buildPoster(streamId, recordingId, uploads);
    const downloadKey = await buildDownloadable(
      streamId,
      recordingId,
      published[0]!,
      uploads,
    );

    log.info({ files: uploads.length }, "uploading recording");
    const result = await uploadAll(uploads);

    if (result.failed.length > 0) {
      // A recording missing segments is worse than no recording: it would
      // play and then stall partway through with no explanation.
      return {
        status: "FAILED",
        durationSeconds: summary.durationSeconds,
        sizeBytes: result.bytes,
        segmentCount: summary.segmentCount,
        renditions: summary.renditions,
        storagePrefix: prefix,
        error: `${result.failed.length} file(s) failed to upload`,
      };
    }

    // The master playlist goes last: until it exists, a partially uploaded
    // recording cannot be played at all, which is the failure mode we want.
    await uploadText(
      master,
      vodObjectKey(recordingId, "master.m3u8"),
      "application/vnd.apple.mpegurl",
    );

    log.info(
      { durationSeconds: summary.durationSeconds, bytes: result.bytes },
      "recording published",
    );

    return {
      status: "READY",
      durationSeconds: summary.durationSeconds,
      sizeBytes: result.bytes,
      segmentCount: summary.segmentCount,
      renditions: summary.renditions,
      storagePrefix: prefix,
      ...(posterKey ? { posterKey } : {}),
      ...(downloadKey ? { downloadKey } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message }, "failed to finalize recording");

    return {
      status: "FAILED",
      durationSeconds: 0,
      sizeBytes: 0,
      segmentCount: 0,
      renditions: [],
      storagePrefix: prefix,
      error: message,
    };
  }
}

/**
 * Picks a poster from the thumbnails written during the class.
 *
 * A frame about a quarter of the way in is far more likely to show the actual
 * lesson than frame zero, which is usually an empty room or a title slide
 * still being adjusted.
 */
async function buildPoster(
  streamId: string,
  recordingId: string,
  uploads: Array<{ localPath: string; key: string }>,
): Promise<string | undefined> {
  const directory = join(liveDir(env.MEDIA_ROOT, streamId), "thumbs");

  let thumbnails: string[];
  try {
    thumbnails = (await readdir(directory)).filter((file) =>
      file.endsWith(".jpg"),
    );
  } catch {
    return undefined;
  }
  if (thumbnails.length === 0) return undefined;

  thumbnails.sort();
  const chosen = thumbnails[Math.floor(thumbnails.length * 0.25)] ?? thumbnails[0]!;

  const key = vodObjectKey(recordingId, "poster.jpg");
  uploads.push({ localPath: join(directory, chosen), key });
  return key;
}

/**
 * Remuxes the encrypted HLS ladder into a downloadable MP4.
 *
 * ffmpeg reads the segments back through a copy of the playlist whose key URI
 * points at the local key file, so it can decrypt without going through the
 * authenticated HTTP endpoint. `-c copy` means this is a container rewrite,
 * not a re-encode: it costs seconds of IO rather than minutes of CPU.
 */
async function buildDownloadable(
  streamId: string,
  recordingId: string,
  rendition: Rendition,
  uploads: Array<{ localPath: string; key: string }>,
): Promise<string | undefined> {
  const directory = liveRenditionDir(env.MEDIA_ROOT, streamId, rendition.name);
  const vodPlaylist = vodVariantPlaylistPath(env.MEDIA_ROOT, streamId, rendition.name);
  const localPlaylist = join(directory, "vod-local.m3u8");
  const output = join(liveDir(env.MEDIA_ROOT, streamId), "download.mp4");

  try {
    const playlist = await readFile(vodPlaylist, "utf8");
    const keyPath = keyFilePath(env.MEDIA_ROOT, streamId);
    await writeFile(localPlaylist, rewriteKeyUri(playlist, `file://${keyPath}`), "utf8");

    const { code, stderr } = await run(
      env.FFMPEG_PATH,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        // Reading a local playlist that references a local key file needs
        // both of these; ffmpeg refuses file:// key URIs otherwise.
        "-allowed_extensions",
        "ALL",
        "-protocol_whitelist",
        "file,crypto,data",
        "-i",
        localPlaylist,
        "-c",
        "copy",
        // Moves the index to the front so the file starts playing before it
        // has finished downloading.
        "-movflags",
        "+faststart",
        "-y",
        output,
      ],
      { timeoutMs: 30 * 60_000 },
    );

    await rm(localPlaylist, { force: true });

    if (code !== 0) {
      logger.warn(
        { streamId, stderr: stderr.slice(0, 400) },
        "mp4 remux failed; the replay is still available for streaming",
      );
      return undefined;
    }

    await stat(output);
    const key = vodObjectKey(recordingId, "download.mp4");
    uploads.push({ localPath: output, key });
    return key;
  } catch (error) {
    // A missing download is a degraded recording, not a failed one.
    logger.warn(
      { streamId, err: error instanceof Error ? error.message : String(error) },
      "could not produce a downloadable mp4",
    );
    return undefined;
  }
}

/** Frees the live working directory once the replay is safely uploaded. */
export async function cleanupLiveDirectory(streamId: string): Promise<void> {
  try {
    await rm(liveDir(env.MEDIA_ROOT, streamId), { recursive: true, force: true });
    await rm(keyFilePath(env.MEDIA_ROOT, streamId), { force: true });
  } catch (error) {
    logger.warn(
      { streamId, err: error instanceof Error ? error.message : String(error) },
      "could not clean up the live directory",
    );
  }
}

export async function reportFinalized(
  recordingId: string,
  result: FinalizeResult,
): Promise<void> {
  await api.completeRecording({
    recordingId,
    status: result.status,
    durationSeconds: result.durationSeconds,
    sizeBytes: result.sizeBytes,
    segmentCount: result.segmentCount,
    renditions: result.renditions,
    storagePrefix: result.storagePrefix,
    ...(result.posterKey ? { posterKey: result.posterKey } : {}),
    ...(result.downloadKey ? { downloadKey: result.downloadKey } : {}),
    ...(result.error ? { error: result.error } : {}),
  });
}
