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

export interface SourceInfo {
  width: number;
  height: number;
  /** Frames per second, rounded. Used to size the GOP. */
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
  encoder: "libx264" | "h264_nvenc" | "h264_vaapi";
  preset: string;
  source: SourceInfo;
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
  const { encoder, preset } = options;
  const args = [
    `-c:v:${index}`,
    encoder,
    `-b:v:${index}`,
    `${rendition.videoKbps}k`,
    `-maxrate:v:${index}`,
    `${rendition.maxrateKbps}k`,
    `-bufsize:v:${index}`,
    `${rendition.bufsizeKbps}k`,
    `-profile:v:${index}`,
    rendition.profile,
  ];

  if (encoder === "libx264") {
    // `zerolatency` disables lookahead and B-frame buffering; it costs a few
    // percent of compression efficiency and removes ~1s of encoder delay,
    // which is the right trade for a live class.
    args.push(`-preset:v:${index}`, preset, `-tune:v:${index}`, "zerolatency");
  } else if (encoder === "h264_nvenc") {
    args.push(`-preset:v:${index}`, "p4", `-tune:v:${index}`, "ll", `-rc:v:${index}`, "cbr");
  }

  return args;
}

export function buildFfmpegArgs(options: LadderOptions): string[] {
  const { source, segmentSeconds } = options;
  const renditions = options.renditions;
  const gop = Math.max(1, Math.round(source.fps * segmentSeconds));

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
  const filters = [`[0:v]split=${renditions.length + 1}${branches}[vthumbsrc]`];

  // `-2` keeps the source aspect ratio while forcing an even width, which
  // H.264's chroma subsampling requires.
  renditions.forEach((rendition, index) => {
    filters.push(`[v${index}]scale=-2:${rendition.height}[v${index}out]`);
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
    "-hls_flags",
    "independent_segments+temp_file+program_date_time",
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
  // poster frame for the recording.
  args.push(
    "-map",
    "[thumb]",
    "-q:v",
    "4",
    "-f",
    "image2",
    "-strftime",
    "0",
    "-update",
    "0",
    `${options.thumbnailDir}/thumb_%05d.jpg`,
  );

  return args;
}

/**
 * The `hls_key_info_file` ffmpeg reads at startup:
 *   line 1  the key URI written verbatim into every playlist
 *   line 2  where ffmpeg reads the actual 16 key bytes from
 *
 * A third line would pin the IV. It is deliberately omitted so ffmpeg derives
 * each segment's IV from its media sequence number: a constant IV would make
 * identical plaintext prefixes (MPEG-TS headers are highly repetitive) encrypt
 * to identical ciphertext across segments. The VOD playlist therefore has to
 * preserve absolute sequence numbers -- see `vod-recorder.ts`.
 */
export function buildKeyInfo(keyUri: string, keyFilePath: string): string {
  return `${keyUri}\n${keyFilePath}\n`;
}
