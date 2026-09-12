import { readFile, writeFile } from "node:fs/promises";

import type { Rendition } from "@stream/shared";
import { liveVariantPlaylistPath, vodVariantPlaylistPath } from "@stream/shared";

import { env } from "./env";
import { logger } from "./logger";
import {
  type PlaylistSegment,
  buildVodPlaylist,
  parseMediaPlaylist,
  totalDuration,
} from "./playlist";

/**
 * Accumulates a complete VOD playlist while the class is still live.
 *
 * ffmpeg's live playlist is a sliding window over the last few seconds; older
 * segments stay on disk but stop being listed. This watcher tails each
 * rendition's playlist and remembers every segment it has ever seen, so when
 * the class ends the replay can be published immediately -- no re-encode, no
 * second pass over the media.
 */
export class VodRecorder {
  private readonly segments = new Map<string, PlaylistSegment[]>();
  private readonly seen = new Map<string, Set<number>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly streamId: string,
    private readonly renditions: Rendition[],
  ) {
    for (const rendition of renditions) {
      this.segments.set(rendition.name, []);
      this.seen.set(rendition.name, new Set());
    }
  }

  start(intervalMs = 2_000): void {
    if (this.timer) return;
    // Polling beats fs.watch here: it is portable across the bind mounts and
    // filesystems this container might run on, and a missed inotify event
    // would silently truncate a recording.
    this.timer = setInterval(() => void this.poll(), intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // One final sweep so segments written between the last tick and shutdown
    // are not lost from the recording.
    await this.poll();
  }

  private async poll(): Promise<void> {
    await Promise.all(
      this.renditions.map((rendition) => this.pollRendition(rendition.name)),
    );
  }

  private async pollRendition(name: string): Promise<void> {
    const path = liveVariantPlaylistPath(env.MEDIA_ROOT, this.streamId, name);

    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      // Normal for the first second or two, before ffmpeg has written it.
      return;
    }

    const parsed = parseMediaPlaylist(text);
    const collected = this.segments.get(name);
    const seen = this.seen.get(name);
    if (!collected || !seen) return;

    for (const segment of parsed.segments) {
      // Sequence numbers are absolute and monotonic, which makes them a
      // reliable identity across successive reads of a sliding window.
      if (seen.has(segment.sequence)) continue;
      seen.add(segment.sequence);
      collected.push(segment);
    }

    collected.sort((a, b) => a.sequence - b.sequence);
  }

  /** Writes each rendition's vod.m3u8. Called once the class has ended. */
  async finalize(): Promise<{
    durationSeconds: number;
    segmentCount: number;
    renditions: string[];
  }> {
    await this.stop();

    let maxDuration = 0;
    let segmentCount = 0;
    const written: string[] = [];

    for (const rendition of this.renditions) {
      const segments = this.segments.get(rendition.name) ?? [];
      if (segments.length === 0) {
        logger.warn(
          { streamId: this.streamId, rendition: rendition.name },
          "no segments captured for rendition; omitting from the recording",
        );
        continue;
      }

      const playlist = buildVodPlaylist(segments, { ended: true });
      await writeFile(
        vodVariantPlaylistPath(env.MEDIA_ROOT, this.streamId, rendition.name),
        playlist,
        "utf8",
      );

      maxDuration = Math.max(maxDuration, totalDuration(segments));
      segmentCount += segments.length;
      written.push(rendition.name);
    }

    return {
      durationSeconds: Math.round(maxDuration * 100) / 100,
      segmentCount,
      renditions: written,
    };
  }

  /** Segment filenames captured per rendition, for the upload step. */
  segmentFiles(): Map<string, string[]> {
    const files = new Map<string, string[]>();
    for (const [name, segments] of this.segments) {
      files.set(
        name,
        segments.map((segment) => segment.uri),
      );
    }
    return files;
  }
}
