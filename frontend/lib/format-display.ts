import type { VideoFormat } from "./types";

function getFormatHeight(format: VideoFormat): number {
  const match = format.resolution.match(/^(\d+)p$/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function getCodecPriority(codec: string): number {
  const normalizedCodec = codec.toLowerCase();

  if (normalizedCodec.includes("avc") || normalizedCodec.includes("h264")) {
    return 3;
  }

  if (
    normalizedCodec.includes("hevc") ||
    normalizedCodec.includes("h265") ||
    normalizedCodec.includes("hev1") ||
    normalizedCodec.includes("hvc1")
  ) {
    return 2;
  }

  if (normalizedCodec.includes("av1") || normalizedCodec.includes("av01")) {
    return 1;
  }

  return 0;
}

function getVideoPriority(format: VideoFormat): number {
  const hasAudio = format.acodec !== "none";
  return (hasAudio ? 100 : 0) + getCodecPriority(format.vcodec);
}

function isAudioOnly(format: VideoFormat): boolean {
  return format.vcodec === "none" && format.acodec !== "none";
}

/**
 * 将后端历史缓存中的多编码格式收拢为用户真正需要的下载选项。
 * 同一清晰度优先选择自带音频的格式，否则按 AVC、HEVC、AV1 的兼容性排序。
 */
export function getDisplayFormats(formats: VideoFormat[]): VideoFormat[] {
  const videoByHeight = new Map<number, VideoFormat>();
  const ungroupedFormats: Array<{ format: VideoFormat; index: number }> = [];
  let bestAudio: VideoFormat | null = null;

  formats.forEach((format, index) => {
    if (isAudioOnly(format)) {
      if (
        !bestAudio ||
        (format.filesize ?? 0) > (bestAudio.filesize ?? 0)
      ) {
        bestAudio = format;
      }
      return;
    }

    const height = getFormatHeight(format);
    if (height <= 0 || format.vcodec === "none") {
      ungroupedFormats.push({ format, index });
      return;
    }

    const currentFormat = videoByHeight.get(height);
    if (!currentFormat || getVideoPriority(format) > getVideoPriority(currentFormat)) {
      videoByHeight.set(height, format);
    }
  });

  const videoFormats = [...videoByHeight.entries()]
    .sort(([firstHeight], [secondHeight]) => secondHeight - firstHeight)
    .map(([, format]) => format);
  const otherFormats = ungroupedFormats
    .sort((first, second) => first.index - second.index)
    .map(({ format }) => format);

  return bestAudio
    ? [...videoFormats, ...otherFormats, bestAudio]
    : [...videoFormats, ...otherFormats];
}
