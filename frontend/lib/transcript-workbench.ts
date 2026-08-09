import { ApiClientError } from "./api";
import { getDefaultTranscribeSettings } from "./transcribe-settings";
import type {
  SummaryHighlight,
  TranscribeContextSettings,
  TranscriptPayload
} from "./types";

export type TranscriptViewMode = "final" | "raw";
export type DraftEditStatus = "saving" | "saved" | "error";

export interface SelectedExcerpt {
  charCount: number;
  end: number | null;
  left: number;
  start: number | null;
  text: string;
  top: number;
}

export const EDIT_SAVE_DEBOUNCE_MS = 700;
export const EDIT_SAVED_MESSAGE_MS = 1400;
const EXCERPT_TEXT_SELECTOR = "[data-transcript-excerpt='true']";

export function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainSeconds
    .toString()
    .padStart(2, "0")}`;
}

export function formatElapsedSeconds(
  seconds: number | null | undefined
): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "未记录";
  }
  return seconds < 60
    ? `${seconds.toFixed(1)} 秒`
    : `${(seconds / 60).toFixed(1)} 分钟`;
}

export function getTranscriptVariantLabel(variantKey: string): string {
  if (variantKey === "local_whisper") {
    return "Whisper";
  }
  if (variantKey === "sensevoice_small") {
    return "SenseVoiceSmall";
  }
  if (variantKey === "fun_asr_flash") {
    return "Fun-ASR-Flash";
  }
  return variantKey;
}

export function inferTranscriptVariantKey(
  transcript: TranscriptPayload
): string {
  const engine = transcript.asr_meta?.engine?.toLowerCase() ?? "";
  if (engine.includes("sensevoice")) {
    return "sensevoice_small";
  }
  if (engine.includes("fun-asr")) {
    return "fun_asr_flash";
  }
  return "local_whisper";
}

export function canShowRawVersion(
  transcript: TranscriptPayload | null
): boolean {
  return Boolean(
    transcript &&
      ((transcript.raw_segments?.length ?? 0) > 0 ||
        transcript.raw_plain_text?.trim())
  );
}

export function getTranscriptForViewMode(
  transcript: TranscriptPayload,
  viewMode: TranscriptViewMode
): TranscriptPayload {
  if (viewMode !== "raw" || !canShowRawVersion(transcript)) {
    return transcript;
  }

  const rawPlainText = transcript.raw_plain_text?.trim() ?? "";
  const rawSegments = transcript.raw_segments ?? [];
  return {
    ...transcript,
    plain_text: rawPlainText || transcript.plain_text,
    segments:
      rawSegments.length > 0
        ? rawSegments
        : rawPlainText
          ? [{ end: 0, start: 0, text: rawPlainText }]
          : transcript.segments
  };
}

function getTextSourceLabel(
  textSourceType: string | null | undefined
): string {
  if (textSourceType === "shownotes") {
    return "Shownotes 原文";
  }
  if (textSourceType === "asr_transcript") {
    return "AI 转写稿";
  }
  if (textSourceType === "subtitle") {
    return "平台字幕";
  }
  if (textSourceType === "curated_excerpt") {
    return "精选摘录";
  }

  return "字幕 / 逐字稿";
}

export function getTranscriptSourceLabel(
  textSourceType: string | null | undefined,
  transcript: TranscriptPayload | null
): string {
  if (textSourceType !== "asr_transcript") {
    return getTextSourceLabel(textSourceType);
  }

  const correctionStatus = transcript?.asr_meta?.correction_status;
  if (correctionStatus === "corrected") {
    return "AI 转写稿 · 已校对";
  }
  if (correctionStatus === "skipped") {
    return "AI 转写稿 · 原始识别";
  }
  if (correctionStatus === "failed") {
    return "AI 转写稿 · 校对失败，已使用原始稿";
  }

  return "AI 转写稿";
}

export function getTextSourceHint(
  textSourceType: string | null | undefined,
  transcript: TranscriptPayload | null
): string | null {
  if (textSourceType === "shownotes") {
    return "这是节目页公开发布的 shownotes 原文，不是完整音频对话稿。";
  }
  if (textSourceType === "asr_transcript") {
    if (transcript?.asr_meta?.correction_status === "corrected") {
      return null;
    }
    if (transcript?.asr_meta?.correction_status === "failed") {
      const engineLabel = getTranscriptVariantLabel(
        inferTranscriptVariantKey(transcript)
      );
      return `自动校对未成功，当前已回退展示 ${engineLabel} 原始识别稿。`;
    }
    return null;
  }
  if (textSourceType === "subtitle") {
    return "当前文本来自平台公开字幕，通常比音频转写更接近原始字幕。";
  }
  if (textSourceType === "curated_excerpt") {
    return "推荐内容仅包含少量公开摘录，不包含完整逐字稿。";
  }

  return null;
}

export function getTextSourceSlug(
  textSourceType: string | null | undefined
): string {
  if (textSourceType === "shownotes") {
    return "shownotes";
  }
  if (textSourceType === "asr_transcript") {
    return "ai-transcript";
  }
  if (textSourceType === "subtitle") {
    return "platform-subtitle";
  }
  if (textSourceType === "curated_excerpt") {
    return "curated-excerpt";
  }

  return "content-text";
}

export function buildInitialTranscribeSettings(
  videoPlatform: string | null | undefined,
  mediaType: string | null | undefined
): TranscribeContextSettings {
  return getDefaultTranscribeSettings({
    platform: videoPlatform ?? "",
    media_type: mediaType ?? null
  });
}

export function getHighlightSourceLabel(highlight: SummaryHighlight): string {
  if (highlight.source === "manual") {
    return "手动摘录";
  }
  if (highlight.source === "local_fallback") {
    return "基础摘录";
  }

  return "AI 摘录";
}

export function sanitizeFilename(value: string): string {
  const sanitizedValue = value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();

  return sanitizedValue.slice(0, 80) || "zhilu-content-text";
}

export function downloadTextFile(
  filename: string,
  text: string,
  type: string
): void {
  const blob = new Blob([text], { type });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function buildDraftTextMap(
  highlights: SummaryHighlight[]
): Record<string, string> {
  return Object.fromEntries(
    highlights.map((highlight) => [highlight.id, highlight.text])
  );
}

function parseExcerptNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function getClampedRangeText(range: Range, element: HTMLElement): string {
  const elementRange = document.createRange();
  elementRange.selectNodeContents(element);

  if (!range.intersectsNode(element)) {
    return "";
  }

  const clampedRange = range.cloneRange();
  if (range.compareBoundaryPoints(Range.START_TO_START, elementRange) < 0) {
    clampedRange.setStart(elementRange.startContainer, elementRange.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, elementRange) > 0) {
    clampedRange.setEnd(elementRange.endContainer, elementRange.endOffset);
  }

  return clampedRange.toString().trim();
}

function getVisibleSelectionRect(
  range: Range,
  root: HTMLElement
): DOMRect | null {
  const rootRect = root.getBoundingClientRect();
  const visibleRects = Array.from(range.getClientRects()).filter(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > rootRect.top &&
      rect.top < rootRect.bottom &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
  );

  return visibleRects[0] ?? null;
}

export function extractSelectedExcerpt(
  root: HTMLElement | null
): SelectedExcerpt | null {
  if (!root) {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const excerptElements = Array.from(
    root.querySelectorAll<HTMLElement>(EXCERPT_TEXT_SELECTOR)
  );
  const selectedParts = excerptElements
    .map((element) => {
      const text = getClampedRangeText(range, element);
      if (!text) {
        return null;
      }

      return {
        end: parseExcerptNumber(element.dataset.excerptEnd),
        start: parseExcerptNumber(element.dataset.excerptStart),
        text
      };
    })
    .filter(
      (part): part is {
        end: number | null;
        start: number | null;
        text: string;
      } => Boolean(part)
    );

  if (selectedParts.length === 0) {
    return null;
  }

  const text = selectedParts.map((part) => part.text).join("\n").trim();
  if (!text) {
    return null;
  }

  const visibleRect = getVisibleSelectionRect(range, root);
  if (!visibleRect) {
    return null;
  }

  const rootRect = root.getBoundingClientRect();
  const left = Math.min(
    Math.max(visibleRect.left + visibleRect.width / 2, 150),
    window.innerWidth - 150
  );
  const top = Math.max(visibleRect.top - 46, rootRect.top + 8, 12);

  return {
    charCount: text.length,
    end: selectedParts[selectedParts.length - 1]?.end ?? null,
    left,
    start: selectedParts[0]?.start ?? null,
    text,
    top
  };
}

export function buildManualHighlightFromExcerpt(
  excerpt: SelectedExcerpt,
  textSourceType: string | null | undefined
): SummaryHighlight {
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: excerpt.text,
    start: excerpt.start,
    end: excerpt.end,
    reason: "用户手动加入摘录草稿",
    tags: [],
    source: "manual",
    source_type: textSourceType ?? "transcript",
    created_at: new Date().toISOString()
  };
}

export function normalizeCandidateHighlight(
  highlight: SummaryHighlight,
  textSourceType: string | null | undefined
): SummaryHighlight {
  return {
    ...highlight,
    id: highlight.id || `ai-${Date.now()}`,
    tags: highlight.tags ?? [],
    source: highlight.source || "ai",
    source_type: highlight.source_type ?? textSourceType ?? "transcript",
    created_at: highlight.created_at ?? new Date().toISOString()
  };
}

export function getHighlightIdentity(highlight: SummaryHighlight): string {
  return [
    highlight.source,
    highlight.start ?? "none",
    highlight.end ?? "none",
    highlight.text.trim()
  ].join("|");
}

export function getNoteErrorMessage(
  error: unknown,
  operation: "save" | "export"
): string {
  if (error instanceof ApiClientError) {
    if (error.errorCode === "LIBRARY_ITEM_NOT_FOUND") {
      return operation === "save"
        ? "当前内容尚未写入本地历史，无法保存摘录草稿。"
        : "当前内容尚未写入本地历史，无法导出知识草稿。";
    }

    if (error.errorCode === "TIMEOUT") {
      return "请求超时，请稍后重试。";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
