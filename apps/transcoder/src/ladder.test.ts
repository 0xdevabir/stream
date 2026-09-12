import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RENDITIONS, parseLadder } from "@stream/shared";

import {
  type LadderOptions,
  type SourceInfo,
  avcCodecString,
  buildFfmpegArgs,
  buildKeyInfo,
  buildMasterPlaylist,
  selectRenditions,
} from "./ladder";

/**
 * The ffmpeg invocation is the one part of this system that cannot be
 * meaningfully tested by "does it run" -- a ladder with misaligned GOPs or a
 * missing encryption flag starts up perfectly and fails only in a viewer's
 * browser, subtly. So the argument construction is asserted directly.
 */

const SOURCE: SourceInfo = { width: 1920, height: 1080, fps: 30, hasAudio: true };

const OPTIONS = (overrides: Partial<LadderOptions> = {}): LadderOptions => ({
  inputUrl: "rtsp://internal:secret@mediamtx:8554/live/abc",
  outputDir: "/media/live/abc",
  keyInfoPath: "/media/keys/abc.keyinfo",
  renditions: parseLadder("1080p,720p,480p,360p"),
  segmentSeconds: 1,
  listSize: 8,
  encoder: "libx264",
  preset: "veryfast",
  source: SOURCE,
  thumbnailDir: "/media/live/abc/thumbs",
  thumbnailIntervalSeconds: 30,
  ...overrides,
});

/** Reads the value that follows a flag, mirroring how ffmpeg parses argv. */
function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("selectRenditions", () => {
  it("never upscales past the source resolution", () => {
    const selected = selectRenditions(parseLadder("1080p,720p,480p,360p"), {
      height: 720,
    });
    assert.deepEqual(
      selected.map((r) => r.name),
      ["720p", "480p", "360p"],
    );
  });

  it("keeps the full ladder for a 1080p source", () => {
    const selected = selectRenditions(parseLadder("1080p,720p,480p,360p"), {
      height: 1080,
    });
    assert.equal(selected.length, 4);
  });

  it("still produces one rendition for a tiny source", () => {
    const selected = selectRenditions(parseLadder("1080p,720p"), { height: 240 });
    assert.deepEqual(
      selected.map((r) => r.name),
      ["720p"],
    );
  });

  it("orders renditions highest first", () => {
    const selected = selectRenditions(parseLadder("360p,1080p,480p"), {
      height: 1080,
    });
    assert.deepEqual(
      selected.map((r) => r.height),
      [1080, 480, 360],
    );
  });
});

describe("avcCodecString", () => {
  it("encodes profile and level per RFC 6381", () => {
    assert.equal(avcCodecString(RENDITIONS["1080p"]), "avc1.640029"); // high 4.1
    assert.equal(avcCodecString(RENDITIONS["720p"]), "avc1.4d401f"); // main 3.1
    assert.equal(avcCodecString(RENDITIONS["360p"]), "avc1.42c01e"); // baseline 3.0
  });
});

describe("buildMasterPlaylist", () => {
  const playlist = buildMasterPlaylist(parseLadder("720p,360p"), { fps: 30 });

  it("declares independent segments so quality switches are seamless", () => {
    assert.match(playlist, /#EXT-X-INDEPENDENT-SEGMENTS/);
  });

  it("lists one variant per rendition, highest first", () => {
    const variants = playlist
      .split("\n")
      .filter((line) => line.endsWith("/index.m3u8"));
    assert.deepEqual(variants, ["720p/index.m3u8", "360p/index.m3u8"]);
  });

  it("advertises peak bandwidth, not just the nominal rate", () => {
    // A player that budgets on the nominal rate will stall on VBV peaks.
    const peak = (RENDITIONS["720p"].maxrateKbps + RENDITIONS["720p"].audioKbps) * 1000;
    assert.match(playlist, new RegExp(`BANDWIDTH=${peak}`));
  });

  it("includes resolution and codecs for each variant", () => {
    assert.match(playlist, /RESOLUTION=1280x720/);
    assert.match(playlist, /CODECS="avc1\.4d401f,mp4a\.40\.2"/);
  });
});

describe("buildFfmpegArgs", () => {
  it("forces aligned keyframes at the segment boundary", () => {
    const args = buildFfmpegArgs(OPTIONS({ segmentSeconds: 2 }));

    // Without all three of these, renditions drift out of alignment and
    // switching quality mid-stream visibly stalls.
    assert.equal(valueAfter(args, "-force_key_frames"), "expr:gte(t,n_forced*2)");
    assert.equal(valueAfter(args, "-sc_threshold"), "0");
    assert.equal(valueAfter(args, "-g"), "60"); // 30fps x 2s
    assert.equal(valueAfter(args, "-keyint_min"), "60");
  });

  it("sizes the GOP from the source frame rate", () => {
    const args = buildFfmpegArgs(
      OPTIONS({ source: { ...SOURCE, fps: 60 }, segmentSeconds: 1 }),
    );
    assert.equal(valueAfter(args, "-g"), "60");
  });

  it("always enables segment encryption", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.equal(
      valueAfter(args, "-hls_key_info_file"),
      "/media/keys/abc.keyinfo",
    );
  });

  it("writes segments atomically so nginx cannot serve a partial file", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.match(valueAfter(args, "-hls_flags") ?? "", /temp_file/);
  });

  it("decodes the source exactly once and splits it", () => {
    const args = buildFfmpegArgs(OPTIONS());
    const graph = valueAfter(args, "-filter_complex") ?? "";

    // 4 renditions + 1 thumbnail branch.
    assert.match(graph, /\[0:v\]split=5/);
    // A filtergraph input can only be consumed once; a second [0:v] would
    // make ffmpeg refuse to start.
    assert.equal(graph.match(/\[0:v\]/g)?.length, 1);
  });

  it("maps every rendition into its own named variant", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.equal(
      valueAfter(args, "-var_stream_map"),
      "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p v:3,a:3,name:360p",
    );
  });

  it("synthesises silence when the source has no audio track", () => {
    const args = buildFfmpegArgs(
      OPTIONS({ source: { ...SOURCE, hasAudio: false } }),
    );

    assert.match(args.join(" "), /anullsrc/);
    // Audio must then come from the generated input, not the (absent) source.
    assert.ok(args.includes("1:a:0"));
    assert.ok(!args.includes("0:a:0"));
  });

  it("takes audio from the source when it has one", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.ok(args.includes("0:a:0"));
    assert.ok(!args.join(" ").includes("anullsrc"));
  });

  it("applies per-rendition bitrate ceilings", () => {
    const args = buildFfmpegArgs(OPTIONS()).join(" ");
    assert.match(args, /-maxrate:v:0 4950k/);
    assert.match(args, /-bufsize:v:0 9000k/);
    assert.match(args, /-maxrate:v:3 770k/);
  });

  it("uses low-latency encoder settings for x264", () => {
    const args = buildFfmpegArgs(OPTIONS()).join(" ");
    assert.match(args, /-tune:v:0 zerolatency/);
    assert.match(args, /-preset:v:0 veryfast/);
  });

  it("switches encoder settings for nvenc", () => {
    const args = buildFfmpegArgs(OPTIONS({ encoder: "h264_nvenc" })).join(" ");
    assert.match(args, /-c:v:0 h264_nvenc/);
    assert.match(args, /-rc:v:0 cbr/);
    assert.doesNotMatch(args, /zerolatency/);
  });

  it("puts the segment pattern and playlist under the stream directory", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.equal(
      valueAfter(args, "-hls_segment_filename"),
      "/media/live/abc/%v/seg_%06d.ts",
    );
    // The HLS output is followed by a second output for poster thumbnails,
    // so the playlist is not the final argument.
    assert.ok(args.includes("/media/live/abc/%v/index.m3u8"));
    assert.equal(args.at(-1), "/media/live/abc/thumbs/thumb_%05d.jpg");
  });
});

describe("buildKeyInfo", () => {
  it("pairs the public key URI with the local key file", () => {
    assert.equal(
      buildKeyInfo("/v1/keys/k_abc", "/media/keys/abc.key"),
      "/v1/keys/k_abc\n/media/keys/abc.key\n",
    );
  });

  it("omits the IV line so ffmpeg derives it from the sequence number", () => {
    // A pinned IV would encrypt identical MPEG-TS headers to identical
    // ciphertext in every segment.
    assert.equal(buildKeyInfo("/v1/keys/k", "/k.key").split("\n").length, 3);
  });
});
