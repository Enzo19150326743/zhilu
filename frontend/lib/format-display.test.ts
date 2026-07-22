import assert from "node:assert/strict";
import test from "node:test";
import { getDisplayFormats } from "./format-display";
import type { VideoFormat } from "./types";

function createFormat(
  formatId: string,
  resolution: string,
  vcodec: string,
  acodec = "none"
): VideoFormat {
  return {
    acodec,
    ext: "mp4",
    filesize: null,
    format_id: formatId,
    label: `${resolution} ${vcodec}`,
    resolution,
    vcodec
  };
}

test("同一视频清晰度只保留兼容性最好的一个编码", () => {
  const formats = [
    createFormat("1080-av1", "1080p", "av01.0.08M.08"),
    createFormat("1080-hevc", "1080p", "hev1.1.6.L120.90"),
    createFormat("1080-avc", "1080p", "avc1.640028"),
    createFormat("720-av1", "720p", "av01.0.05M.08")
  ];

  assert.deepEqual(
    getDisplayFormats(formats).map((format) => format.format_id),
    ["1080-avc", "720-av1"]
  );
});

test("音频格式只保留一个，独立清晰度仍按从高到低排列", () => {
  const formats = [
    createFormat("audio-small", "audio only", "none", "mp4a.40.2"),
    {
      ...createFormat("audio-large", "audio only", "none", "mp4a.40.2"),
      filesize: 20_000_000
    },
    createFormat("480-avc", "480p", "avc1.4d401f"),
    createFormat("1080-avc", "1080p", "avc1.640028")
  ];

  assert.deepEqual(
    getDisplayFormats(formats).map((format) => format.format_id),
    ["1080-avc", "480-avc", "audio-large"]
  );
});

test("带音频的普通格式按清晰度去重并优先于仅视频格式", () => {
  const formats = [
    createFormat("720-video-only", "720p", "avc1.64001f"),
    createFormat("720-combined", "720p", "avc1.64001f", "mp4a.40.2")
  ];

  assert.deepEqual(
    getDisplayFormats(formats).map((format) => format.format_id),
    ["720-combined"]
  );
});
