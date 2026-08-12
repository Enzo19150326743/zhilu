import type { LibraryFilter, LibraryItem } from "./types";

export function isShownotesLibraryItem(item: LibraryItem): boolean {
  return item.text_source_type === "shownotes";
}

export function isLibraryItemSummarized(item: LibraryItem): boolean {
  if (!item.has_transcript || isShownotesLibraryItem(item)) {
    return false;
  }

  return (
    item.summary_status === "ai_generated" ||
    item.summary_status === "local_fallback"
  );
}

export function getLibraryStatusLabel(
  item: LibraryItem,
  isProcessing = false
): string {
  if (isProcessing) {
    return "处理中";
  }

  if (!item.has_transcript || isShownotesLibraryItem(item)) {
    return "需转写";
  }

  if (item.summary_status === "ai_generated") {
    return "已总结";
  }

  if (item.summary_status === "local_fallback") {
    return "基础摘要";
  }

  return "可总结";
}

export function getLibraryDisplayTitle(value: string): string {
  const normalizedValue = value.replace(/\s+/g, " ").trim();
  if (!normalizedValue) {
    return "未命名内容";
  }

  const withoutHashtags = normalizedValue.split(/\s+#/u)[0]?.trim() || normalizedValue;
  const sentenceMatch = withoutHashtags.match(/^.{8,64}?[。！？!?]/u);
  const firstSentence = sentenceMatch?.[0]?.trim();
  if (
    firstSentence &&
    withoutHashtags.slice(firstSentence.length).trim().length > 12
  ) {
    return firstSentence;
  }

  if (withoutHashtags.length <= 68) {
    return withoutHashtags;
  }

  if (firstSentence) {
    return firstSentence;
  }

  return `${withoutHashtags.slice(0, 66).trimEnd()}…`;
}

function getUpdatedTimestamp(item: LibraryItem): number {
  const timestamp = new Date(item.updated_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getFeaturedLibraryItems(
  items: LibraryItem[],
  limit = 3
): LibraryItem[] {
  return [...items]
    .sort((leftItem, rightItem) =>
      getUpdatedTimestamp(rightItem) - getUpdatedTimestamp(leftItem)
    )
    .slice(0, limit);
}

export function formatLibraryUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚更新";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(date);
}

export function matchesLibraryFilter(
  item: LibraryItem,
  filter: LibraryFilter
): boolean {
  if (filter === "ready") {
    return (
      item.has_transcript &&
      !isShownotesLibraryItem(item) &&
      !isLibraryItemSummarized(item)
    );
  }

  if (filter === "summarized") {
    return isLibraryItemSummarized(item);
  }

  if (filter === "noTranscript") {
    return !item.has_transcript || isShownotesLibraryItem(item);
  }

  return true;
}
