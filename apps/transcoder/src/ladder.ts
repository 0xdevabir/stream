import { createHmac } from "node:crypto";

import type { Rendition } from "@stream/shared";

/**
 * Construction of the ffmpeg invocation that produces the whole encrypted ABR
 * ladder from a single source, in a single process.
 *
 * Three properties matter here, and all three are easy to get subtly wrong:
 *
 *  1. GOP alignment. Every rendition must place its keyframes at exactly the
 *     same timestamps, or a player switching quality mid-stream stalls while
 *     it waits for a keyframe. `-force_key_frames` on a shared expression plus
 *     `-sc_threshold 0` (no extra keyframes on scene cuts) guarantees it.
 *  2. One process. Running four ffmpeg instances against the same RTSP source
 *     would decode it four times and drift out of alignment.
 *  3. Encryption. `-hls_key_info_file` makes ffmpeg AES-128 every segment and
 *     write the key URI into each playlist, so the player fetches the key from
 *     our authenticated endpoint before it can decode anything.
 */

export type VideoEncoder = "libx264" | "h264_nvenc" | "h264_qsv" | "h264_vaapi";
export type RateControl = "capped-crf" | "cbr";

export interface SourceInfo {
  width: number;
  height: number;
  /** Frames per second, rounded. */
  fps: number;
  hasAudio: boolean;
}

export interface LadderOptions {
  inputUrl: string;
  outputDir: string;
  keyInfoPath: string;
  renditions: Rendition[];
  segmentSeconds: number;
  listSize: number;
  encoder: VideoEncoder;
  preset: string;
  /**
   * `capped-crf` spends bits only where the picture changes and treats each
   * rendition's maxrate as a ceiling; `cbr` holds the nominal rate regardless.
   */
  rateControl: RateControl;
  /** CRF / CQ / QVBR quality target for `capped-crf`. Lower is better. */
  quality: number;
  /** DRI render node, used by the VAAPI encoder. */
  hwDevice: string;
  source: SourceInfo;
  /** Encoded frame rate, from `outputFps`. Sizes the GOP. */
  fps: number;
  /** Where periodic thumbnails are written, for the recording's poster. */
  thumbnailDir: string;
  thumbnailIntervalSeconds: number;
}

/**
 * Never encode above the source resolution.
 *
 * Upscaling costs real CPU and bandwidth to deliver a blurrier picture than
 * the source, so a 720p webcam produces a 720p/480p/360p ladder rather than a
 * fake 1080p rung. The top rung is always kept even if the source is tiny, so
 * there is always at least one rendition.
 */
export function selectRenditions(
  renditions: Rendition[],
  source: Pick<SourceInfo, "height">,
): Rendition[] {
  const ordered = [...renditions].sort((a, b) => b.height - a.height);
  const fitting = ordered.filter((rendition) => rendition.height <= source.height);
  return fitting.length > 0 ? fitting : [ordered.at(-1)!];
}

/**
 * The frame rate the ladder is encoded at: the source's, capped at `maxFps`.
 *
 * A lecture gains nothing visible from 60fps, but it doubles encode work and
 * adds roughly a third to every viewer's bitrate -- and bandwidth is the cost
 * that grows with the audience.
 */
export function outputFps(source: Pick<SourceInfo, "fps">, maxFps: number): number {
  return Math.min(source.fps, maxFps);
}

/** RFC 6381 codec string, needed by the multivariant playlist. */
export function avcCodecString(rendition: Rendition): string {
  const profileIdc = { baseline: 0x42, main: 0x4d, high: 0x64 }[rendition.profile];
  const constraints = { baseline: 0xc0, main: 0x40, high: 0x00 }[rendition.profile];
  const [major, minor] = rendition.level.split(".").map(Number);
  const levelIdc = (major ?? 3) * 10 + (minor ?? 0);

  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `avc1.${hex(profileIdc)}${hex(constraints)}${hex(levelIdc)}`;
}

export function aacCodecString(): string {
  return "mp4a.40.2";
}

/**
 * The multivariant ("master") playlist.
 *
 * Written by us rather than by ffmpeg's `-master_pl_name`, whose output path
 * behaviour under `%v` substitution is version-dependent. Generating it here
 * is a dozen lines, is deterministic, and is directly testable.
 */
export function buildMasterPlaylist(
  renditions: Rendition[],
  options: { variantPlaylistName?: string; fps?: number } = {},
): string {
  const name = options.variantPlaylistName ?? "index.m3u8";

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    // Tells the player every segment can be decoded independently, which is
    // what makes a mid-stream quality switch seamless.
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];

  for (const rendition of renditions) {
    const peak = (rendition.maxrateKbps + rendition.audioKbps) * 1000;
    const average = (rendition.videoKbps + rendition.audioKbps) * 1000;
    const codecs = `${avcCodecString(rendition)},${aacCodecString()}`;

    const attributes = [
      `BANDWIDTH=${peak}`,
      `AVERAGE-BANDWIDTH=${average}`,
      `RESOLUTION=${rendition.width}x${rendition.height}`,
      `CODECS="${codecs}"`,
    ];
    if (options.fps) attributes.push(`FRAME-RATE=${options.fps.toFixed(3)}`);

    lines.push(`#EXT-X-STREAM-INF:${attributes.join(",")}`);
    lines.push(`${rendition.name}/${name}`);
  }

  return `${lines.join("\n")}\n`;
}

function encoderArgs(
  options: LadderOptions,
  rendition: Rendition,
  index: number,
): string[] {
  const { encoder, preset, quality } = options;
  const capped = options.rateControl === "capped-crf";
  const opt = (name: string, value: string | number) => [
    `-${name}:v:${index}`,
    String(value),
  ];
  const nominal = `${rendition.videoKbps}k`;

  // VAAPI names the baseline profile after what it actually produces.
  const profile =
    encoder === "h264_vaapi" && rendition.profile === "baseline"
      ? "constrained_baseline"
      : rendition.profile;

  const args = [
    `-c:v:${index}`,
    encoder,
    ...opt("maxrate", `${rendition.maxrateKbps}k`),
    ...opt("bufsize", `${rendition.bufsizeKbps}k`),
    ...opt("profile", profile),
  ];

  // Capped CRF is where most of the bandwidth saving is: a static slide costs
  // a few hundred kbps instead of the whole rung, while motion can still use
  // up to maxrate. Every viewer downloads every bit, so the saving is paid
  // back per viewer rather than once.
  switch (encoder) {
    case "libx264":
      // `zerolatency` disables lookahead and B-frame buffering; it costs a few
      // percent of compression efficiency and removes ~1s of encoder delay,
      // which is the right trade for a live class.
      args.push(...opt("preset", preset), ...opt("tune", "zerolatency"));
      args.push(...(capped ? opt("crf", quality) : opt("b", nominal)));
      break;
    case "h264_nvenc":
      args.push(...opt("preset", "p4"), ...opt("tune", "ll"));
      args.push(
        ...(capped
          ? [...opt("rc", "vbr"), ...opt("cq", quality), ...opt("b", 0)]
          : [...opt("rc", "cbr"), ...opt("b", nominal)]),
      );
      break;
    case "h264_qsv":
      // A quality target plus a maxrate above the nominal rate makes ffmpeg
      // pick QSV's QVBR mode -- the hardware counterpart of capped CRF.
      args.push(...opt("preset", "veryfast"), ...opt("b", nominal));
      if (capped) args.push(...opt("global_quality", quality));
      break;
    case "h264_vaapi":
      // Not every VAAPI driver implements QVBR (AMD's does not), so VBR is
      // the portable approximation. Intel hardware should prefer h264_qsv.
      args.push(...opt("rc_mode", capped ? "VBR" : "CBR"), ...opt("b", nominal));
      break;
  }

  return args;
}

/**
 * Filter tail that hands each rendition's frames to the encoder in the form
 * it accepts. Decode and scale stay in software for every backend: they are
 * cheap next to encoding, and it keeps one filter graph for all of them.
 */
function uploadFilter(encoder: VideoEncoder): string {
  if (encoder === "h264_vaapi") return ",format=nv12,hwupload";
  if (encoder === "h264_qsv") return ",format=nv12";
  return "";
}

export function buildFfmpegArgs(options: LadderOptions): string[] {
  const { source, segmentSeconds, fps, encoder } = options;
  const renditions = options.renditions;
  const gop = Math.max(1, Math.round(fps * segmentSeconds));

  const args: string[] = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    // RTSP over TCP: the source is a localhost hop where reliability beats the
    // microseconds UDP would save.
    "-rtsp_transport",
    "tcp",
    "-fflags",
    "+genpts",
    ...(encoder === "h264_vaapi" ? ["-vaapi_device", options.hwDevice] : []),
    "-i",
    options.inputUrl,
  ];

  // A screen-share source may carry no audio at all. Rather than special-case
  // the ladder, synthesise silence so every rendition has the audio track that
  // players (and the master playlist's CODECS attribute) expect.
  if (!source.hasAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
    );
  }
  const audioInput = source.hasAudio ? "0:a:0" : "1:a:0";

  // One decode, split N+1 ways: one branch per rendition plus a low-rate
  // branch for poster thumbnails. A filtergraph input may only be consumed
  // once, so every branch has to come out of this single split.
  const branches = renditions.map((_, index) => `[v${index}]`).join("");
  // Frame-rate reduction goes before the split, so it happens once.
  const decimate = fps < source.fps ? `fps=${fps},` : "";
  const filters = [
    `[0:v]${decimate}split=${renditions.length + 1}${branches}[vthumbsrc]`,
  ];

  // `-2` keeps the source aspect ratio while forcing an even width, which
  // H.264's chroma subsampling requires.
  renditions.forEach((rendition, index) => {
    filters.push(
      `[v${index}]scale=-2:${rendition.height}${uploadFilter(encoder)}[v${index}out]`,
    );
  });

  filters.push(
    `[vthumbsrc]fps=1/${options.thumbnailIntervalSeconds},scale=-2:360[thumb]`,
  );

  args.push("-filter_complex", filters.join(";"));

  renditions.forEach((rendition, index) => {
    args.push("-map", `[v${index}out]`);
    args.push(...encoderArgs(options, rendition, index));
  });

  // Audio is encoded once per rendition. That is a few percent of one core
  // each, and it keeps every variant self-contained -- an audio rendition
  // group would complicate the playlist for no benefit at these bitrates.
  renditions.forEach((rendition, index) => {
    args.push("-map", audioInput);
    args.push(`-c:a:${index}`, "aac", `-b:a:${index}`, `${rendition.audioKbps}k`);
    args.push(`-ac:a:${index}`, "2", `-ar:a:${index}`, "48000");
  });

  args.push(
    "-sc_threshold",
    "0",
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    // The line that actually guarantees aligned, exactly-segment-length GOPs.
    "-force_key_frames",
    `expr:gte(t,n_forced*${segmentSeconds})`,
  );

  const varStreamMap = renditions
    .map((rendition, index) => `v:${index},a:${index},name:${rendition.name}`)
    .join(" ");

  args.push(
    "-f",
    "hls",
    "-hls_time",
    String(segmentSeconds),
    "-hls_list_size",
    String(options.listSize),
    // `temp_file` writes to a .tmp then renames, so nginx can never serve a
    // half-written segment. `program_date_time` gives the player a wall-clock
    // anchor, which the latency readout in the UI uses.
    //
    // `append_list` and `omit_endlist` are what let a class survive its
    // publisher dropping out. ffmpeg is restarted when the source returns;
    // with `append_list` the new process continues the segment numbering and
    // marks an EXT-X-DISCONTINUITY instead of starting again at seg_000000
    // and overwriting the class so far. `omit_endlist` stops the exiting
    // process from ending the live playlist, which players would take as the
    // class being over. The replay gets its ENDLIST from the VOD playlist.
    "-hls_flags",
    "independent_segments+temp_file+program_date_time+append_list+omit_endlist",
    "-hls_segment_type",
    "mpegts",
    "-hls_key_info_file",
    options.keyInfoPath,
    "-hls_segment_filename",
    `${options.outputDir}/%v/seg_%06d.ts`,
    "-var_stream_map",
    varStreamMap,
    `${options.outputDir}/%v/index.m3u8`,
  );

  // Thumbnails: a second output, written unencrypted, used only to pick a
  // poster frame for the recording. Named by wall-clock second rather than a
  // counter, so a restarted ffmpeg cannot overwrite earlier frames and the
  // names still sort chronologically.
  args.push(
    "-map",
    "[thumb]",
    "-q:v",
    "4",
    "-f",
    "image2",
    "-strftime",
    "1",
    "-update",
    "0",
    `${options.thumbnailDir}/thumb_%s.jpg`,
  );

  return args;
}

/**
 * The `hls_key_info_file` ffmpeg reads at startup:
 *   line 1  the key URI written verbatim into every playlist
 *   line 2  where ffmpeg reads the actual 16 key bytes from
 *   line 3  the AES-128 IV, as 32 hex digits
 *
 * The third line is not optional in practice. RFC 8216 says an absent IV
 * attribute means "use the media sequence number", which would give every
 * segment a distinct IV -- but ffmpeg's hlsenc does not implement that. Given
 * no IV it snapshots the sequence number *once*, at encoder start, and reuses
 * the result for the whole run; since encoding starts at sequence 0, every
 * segment of every rendition ends up encrypted under an all-zero IV. That was
 * verified against real output, not inferred from the docs.
 *
 * So we pin an IV explicitly and make it unpredictable per stream. See
 * `deriveIv`.
 */
export function buildKeyInfo(
  keyUri: string,
  keyFilePath: string,
  ivHex: string,
): string {
  if (!/^[0-9a-f]{32}$/i.test(ivHex)) {
    throw new Error(`IV must be 32 hex digits, got ${JSON.stringify(ivHex)}`);
  }
  return `${keyUri}\n${keyFilePath}\n${ivHex.toLowerCase()}\n`;
}

/**
 * A stream's AES-128 IV, derived from its content key.
 *
 * Deterministic on purpose: if the transcoder restarts mid-class it must
 * produce the same IV, or the segments written before the restart would no
 * longer decrypt under the playlist's single EXT-X-KEY line and the recording
 * would be corrupt from that point on. Deriving beats storing -- there is no
 * extra column to migrate and no way for the two to drift apart.
 *
 * An IV is not a secret (it is published in the playlist); it only has to be
 * unpredictable and not reused across keys, and an HMAC under the content key
 * gives both.
 */
export function deriveIv(contentKeyHex: string, streamId: string): string {
  return createHmac("sha256", Buffer.from(contentKeyHex, "hex"))
    .update(`hls-iv:${streamId}`)
    .digest("hex")
    .slice(0, 32);
}
