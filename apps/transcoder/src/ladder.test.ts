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
  deriveIv,
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
  rateControl: "capped-crf",
  quality: 23,
  hwDevice: "/dev/dri/renderD128",
  source: SOURCE,
  fps: 30,
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

  it("sizes the GOP from the encoded frame rate", () => {
    const args = buildFfmpegArgs(
      OPTIONS({ source: { ...SOURCE, fps: 60 }, fps: 60, segmentSeconds: 1 }),
    );
    assert.equal(valueAfter(args, "-g"), "60");
  });

  it("decimates a high frame rate source once, before the split", () => {
    const args = buildFfmpegArgs(
      OPTIONS({ source: { ...SOURCE, fps: 60 }, fps: 30 }),
    );
    assert.match(valueAfter(args, "-filter_complex") ?? "", /^\[0:v\]fps=30,split=5/);
    // The GOP follows the output rate, or segments would be 2s long.
    assert.equal(valueAfter(args, "-g"), "30");
  });

  it("leaves the frame rate alone when the source is within the cap", () => {
    const graph = valueAfter(buildFfmpegArgs(OPTIONS()), "-filter_complex") ?? "";
    assert.doesNotMatch(graph, /fps=30,/);
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

  it("continues the class across an encoder restart instead of overwriting it", () => {
    const flags = valueAfter(buildFfmpegArgs(OPTIONS()), "-hls_flags") ?? "";
    // Without these a publisher reconnect restarts numbering at zero and ends
    // the live playlist, which viewers see as the class finishing.
    assert.match(flags, /append_list/);
    assert.match(flags, /omit_endlist/);
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

  it("uses capped CRF for x264 by default, with no nominal bitrate", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.equal(valueAfter(args, "-crf:v:0"), "23");
    // A -b:v alongside -crf would switch x264 back to ABR.
    assert.equal(valueAfter(args, "-b:v:0"), undefined);
  });

  it("holds the nominal bitrate under cbr", () => {
    const args = buildFfmpegArgs(OPTIONS({ rateControl: "cbr" }));
    assert.equal(valueAfter(args, "-b:v:0"), "4500k");
    assert.equal(valueAfter(args, "-crf:v:0"), undefined);
  });

  it("switches encoder settings for nvenc", () => {
    const args = buildFfmpegArgs(OPTIONS({ encoder: "h264_nvenc" })).join(" ");
    assert.match(args, /-c:v:0 h264_nvenc/);
    assert.match(args, /-rc:v:0 vbr -cq:v:0 23 -b:v:0 0/);
    assert.doesNotMatch(args, /zerolatency/);

    const cbr = buildFfmpegArgs(
      OPTIONS({ encoder: "h264_nvenc", rateControl: "cbr" }),
    ).join(" ");
    assert.match(cbr, /-rc:v:0 cbr/);
  });

  it("feeds QSV nv12 frames and asks it for QVBR", () => {
    const args = buildFfmpegArgs(OPTIONS({ encoder: "h264_qsv" }));
    assert.match(valueAfter(args, "-filter_complex") ?? "", /scale=-2:1080,format=nv12\[v0out\]/);
    assert.equal(valueAfter(args, "-global_quality:v:0"), "23");
    assert.equal(valueAfter(args, "-b:v:0"), "4500k");
  });

  it("uploads frames to the VAAPI device before encoding", () => {
    const args = buildFfmpegArgs(OPTIONS({ encoder: "h264_vaapi" }));
    assert.equal(valueAfter(args, "-vaapi_device"), "/dev/dri/renderD128");
    // The device has to be opened before the input it filters.
    assert.ok(args.indexOf("-vaapi_device") < args.indexOf("-i"));
    assert.match(valueAfter(args, "-filter_complex") ?? "", /format=nv12,hwupload\[v0out\]/);
    // VAAPI has no plain "baseline" profile constant.
    assert.equal(valueAfter(args, "-profile:v:3"), "constrained_baseline");
  });

  it("keeps software encoders free of hardware plumbing", () => {
    const args = buildFfmpegArgs(OPTIONS());
    assert.ok(!args.includes("-vaapi_device"));
    assert.doesNotMatch(valueAfter(args, "-filter_complex") ?? "", /hwupload|nv12/);
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
    assert.equal(args.at(-1), "/media/live/abc/thumbs/thumb_%s.jpg");
    assert.equal(valueAfter(args, "-strftime"), "1");
  });
});

describe("buildKeyInfo", () => {
  const IV = "00112233445566778899aabbccddeeff";

  it("pairs the public key URI with the local key file and an IV", () => {
    assert.equal(
      buildKeyInfo("/v1/keys/k_abc", "/media/keys/abc.key", IV),
      `/v1/keys/k_abc\n/media/keys/abc.key\n${IV}\n`,
    );
  });

  it("pins the IV explicitly", () => {
    // ffmpeg's hlsenc does not implement RFC 8216's "absent IV means use the
    // media sequence number". Given no IV it silently encrypts every segment
    // under an all-zero one, so the line has to be there.
    const lines = buildKeyInfo("/v1/keys/k", "/k.key", IV).trimEnd().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[2], IV);
  });

  it("rejects an IV that is not 32 hex digits", () => {
    assert.throws(() => buildKeyInfo("/v1/keys/k", "/k.key", "abc"), /32 hex/);
  });
});

describe("deriveIv", () => {
  const KEY = "0123456789abcdef0123456789abcdef";

  it("returns 32 hex digits", () => {
    assert.match(deriveIv(KEY, "stream-1"), /^[0-9a-f]{32}$/);
  });

  it("is stable for a given key and stream", () => {
    // A restart mid-class must not change the IV, or every segment written
    // before it becomes undecryptable under the playlist's key line.
    assert.equal(deriveIv(KEY, "stream-1"), deriveIv(KEY, "stream-1"));
  });

  it("differs per stream and per key", () => {
    assert.notEqual(deriveIv(KEY, "stream-1"), deriveIv(KEY, "stream-2"));
    assert.notEqual(
      deriveIv(KEY, "stream-1"),
      deriveIv("fedcba9876543210fedcba9876543210", "stream-1"),
    );
  });

  it("is never all zeroes", () => {
    assert.notEqual(deriveIv(KEY, "stream-1"), "0".repeat(32));
  });
});
