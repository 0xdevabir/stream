import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildVodPlaylist,
  parseMediaPlaylist,
  rewriteKeyUri,
  totalDuration,
} from "./playlist";

/**
 * These tests exist mainly to protect one property: a replay must decrypt.
 *
 * Because no IV is pinned in the key info file, ffmpeg uses each segment's
 * absolute media sequence number as its AES-128 IV. Renumbering segments when
 * building the VOD playlist would therefore produce a recording that plays as
 * garbage -- a failure that would only show up minutes after a class ended.
 */

const LIVE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-MEDIA-SEQUENCE:12
#EXT-X-KEY:METHOD=AES-128,URI="/v1/keys/k_abc"
#EXT-X-PROGRAM-DATE-TIME:2026-09-12T10:00:12.000Z
#EXTINF:1.000000,
seg_000012.ts
#EXTINF:1.000000,
seg_000013.ts
#EXTINF:0.960000,
seg_000014.ts
`;

describe("parseMediaPlaylist", () => {
  const parsed = parseMediaPlaylist(LIVE_PLAYLIST);

  it("reads the media sequence and target duration", () => {
    assert.equal(parsed.mediaSequence, 12);
    assert.equal(parsed.targetDuration, 1);
    assert.equal(parsed.ended, false);
  });

  it("numbers segments from the media sequence, not from zero", () => {
    assert.deepEqual(
      parsed.segments.map((segment) => segment.sequence),
      [12, 13, 14],
    );
  });

  it("carries the key forward to every segment it covers", () => {
    for (const segment of parsed.segments) {
      assert.equal(
        segment.key,
        '#EXT-X-KEY:METHOD=AES-128,URI="/v1/keys/k_abc"',
      );
    }
  });

  it("attaches the program date time to the segment that follows it", () => {
    assert.equal(
      parsed.segments[0]?.programDateTime,
      "2026-09-12T10:00:12.000Z",
    );
    assert.equal(parsed.segments[1]?.programDateTime, null);
  });

  it("preserves fractional durations", () => {
    assert.equal(parsed.segments[2]?.duration, 0.96);
  });

  it("recognises a finished playlist", () => {
    assert.equal(
      parseMediaPlaylist(`${LIVE_PLAYLIST}#EXT-X-ENDLIST\n`).ended,
      true,
    );
  });

  it("tolerates an empty playlist", () => {
    const empty = parseMediaPlaylist("#EXTM3U\n#EXT-X-VERSION:3\n");
    assert.deepEqual(empty.segments, []);
  });

  it("handles a discontinuity marker", () => {
    const withGap = parseMediaPlaylist(
      `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:1.0,\nb.ts\n`,
    );
    assert.equal(withGap.segments[0]?.discontinuity, false);
    assert.equal(withGap.segments[1]?.discontinuity, true);
  });
});

describe("buildVodPlaylist", () => {
  const segments = parseMediaPlaylist(LIVE_PLAYLIST).segments;

  it("preserves absolute sequence numbers so AES-128 IVs still match", () => {
    const playlist = buildVodPlaylist(segments, { ended: true });
    // The critical assertion: 12, not 0.
    assert.match(playlist, /#EXT-X-MEDIA-SEQUENCE:12/);
  });

  it("marks the playlist as VOD and closes it", () => {
    const playlist = buildVodPlaylist(segments, { ended: true });
    assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD/);
    assert.match(playlist, /#EXT-X-ENDLIST\n$/);
  });

  it("leaves the playlist open while still recording", () => {
    const playlist = buildVodPlaylist(segments, { ended: false });
    assert.doesNotMatch(playlist, /#EXT-X-ENDLIST/);
  });

  it("emits the key once rather than before every segment", () => {
    const playlist = buildVodPlaylist(segments, { ended: true });
    assert.equal(playlist.match(/#EXT-X-KEY/g)?.length, 1);
  });

  it("re-emits the key when it changes mid-recording", () => {
    const rotated = [
      ...segments,
      { ...segments[0]!, sequence: 15, key: '#EXT-X-KEY:METHOD=AES-128,URI="/v1/keys/k_new"' },
    ];
    const playlist = buildVodPlaylist(rotated, { ended: true });
    assert.equal(playlist.match(/#EXT-X-KEY/g)?.length, 2);
  });

  it("rounds target duration up to cover the longest segment", () => {
    const long = [{ ...segments[0]!, duration: 2.4 }];
    assert.match(buildVodPlaylist(long, { ended: true }), /#EXT-X-TARGETDURATION:3/);
  });

  it("lists every segment in order", () => {
    const playlist = buildVodPlaylist(segments, { ended: true });
    const uris = playlist.split("\n").filter((line) => line.endsWith(".ts"));
    assert.deepEqual(uris, ["seg_000012.ts", "seg_000013.ts", "seg_000014.ts"]);
  });

  it("produces a valid, closed playlist even with no segments", () => {
    const playlist = buildVodPlaylist([], { ended: true });
    assert.match(playlist, /^#EXTM3U/);
    assert.match(playlist, /#EXT-X-ENDLIST/);
  });

  it("round-trips through the parser", () => {
    const playlist = buildVodPlaylist(segments, { ended: true });
    const reparsed = parseMediaPlaylist(playlist);

    assert.equal(reparsed.ended, true);
    assert.deepEqual(
      reparsed.segments.map((segment) => segment.sequence),
      [12, 13, 14],
    );
  });
});

describe("rewriteKeyUri", () => {
  it("points the key at a local file for offline remuxing", () => {
    const rewritten = rewriteKeyUri(LIVE_PLAYLIST, "file:///media/keys/abc.key");
    assert.match(rewritten, /URI="file:\/\/\/media\/keys\/abc\.key"/);
    assert.doesNotMatch(rewritten, /\/v1\/keys/);
  });

  it("leaves the rest of the key line intact", () => {
    const rewritten = rewriteKeyUri(LIVE_PLAYLIST, "file:///k.key");
    assert.match(rewritten, /#EXT-X-KEY:METHOD=AES-128,URI="file:\/\/\/k\.key"/);
  });
});

describe("totalDuration", () => {
  it("sums segment durations", () => {
    const segments = parseMediaPlaylist(LIVE_PLAYLIST).segments;
    assert.equal(Math.round(totalDuration(segments) * 100) / 100, 2.96);
  });
});
