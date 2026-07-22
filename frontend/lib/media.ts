import type { LibraryItem, VideoInfo } from "./types";

type MediaLike = {
  media_type?: VideoInfo["media_type"] | LibraryItem["media_type"];
  platform?: VideoInfo["platform"] | LibraryItem["platform"] | null;
  text_source_type?:
    | VideoInfo["text_source_type"]
    | LibraryItem["text_source_type"];
};

export function getMediaType(media: MediaLike | null | undefined): string {
  if (media?.media_type) {
    return media.media_type;
  }

  return media?.platform === "xiaoyuzhou" ? "podcast" : "video";
}

export function getTextSourceType(media: MediaLike | null | undefined): string {
  if (media?.text_source_type) {
    return media.text_source_type;
  }

  return getMediaType(media) === "podcast" ? "shownotes" : "subtitle";
}

export function isPodcastMedia(media: MediaLike | null | undefined): boolean {
  return getMediaType(media) === "podcast";
}

export function isShownotesSource(media: MediaLike | null | undefined): boolean {
  return getTextSourceType(media) === "shownotes";
}

export function getTextSourceLabel(media: MediaLike | null | undefined): string {
  const textSourceType = getTextSourceType(media);
  if (textSourceType === "shownotes") {
    return "公开笔记 / 内容简介";
  }
  if (textSourceType === "asr_transcript") {
    return "转写稿";
  }
  if (textSourceType === "subtitle") {
    return "平台字幕";
  }
  if (textSourceType === "curated_excerpt") {
    return "精选摘录";
  }

  return "字幕 / 逐字稿";
}

export function getLibraryTextStatusLabel(item: LibraryItem): string {
  if (!item.has_transcript || isShownotesSource(item)) {
    return "需转写";
  }

  return "可总结";
}
