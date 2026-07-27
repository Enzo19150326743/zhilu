"use client";

import {
  BookOpenText,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  FileAudio,
  FileDown,
  GitCompareArrows,
  Loader2,
  Plus,
  Quote,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiClient } from "@/lib/api";
import { getDefaultTranscribeSettings } from "@/lib/transcribe-settings";
import type {
  NoteDraft,
  SummaryHighlight,
  TranscribeContextSettings,
  TranscriptPayload,
  VideoSummary
} from "@/lib/types";
import { TranscribeSettingsPanel } from "./TranscribeSettingsPanel";

interface TranscriptTabProps {
  canTranscribe: boolean;
  hasTranscript: boolean;
  isTranscribing: boolean;
  mediaType?: string | null;
  noteDraft?: NoteDraft | null;
  sourceUrl?: string | null;
  summary: VideoSummary | null;
  textSourceType?: string | null;
  transcribeErrorMessage: string | null;
  transcript: TranscriptPayload | null;
  transcriptVariants: Record<string, TranscriptPayload>;
  activeTranscriptVariant?: string | null;
  videoPlatform?: string | null;
  videoTitle?: string | null;
  onSaveNoteDraft: (sourceUrl: string, noteDraft: NoteDraft) => Promise<NoteDraft>;
  onTranscribe: (settings?: TranscribeContextSettings) => void;
}

type TranscriptViewMode = "final" | "raw";
type DraftEditStatus = "saving" | "saved" | "error";

interface SelectedExcerpt {
  charCount: number;
  end: number | null;
  left: number;
  start: number | null;
  text: string;
  top: number;
}

const EDIT_SAVE_DEBOUNCE_MS = 700;
const EDIT_SAVED_MESSAGE_MS = 1400;
const EXCERPT_TEXT_SELECTOR = "[data-transcript-excerpt='true']";

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainSeconds
    .toString()
    .padStart(2, "0")}`;
}

function formatElapsedSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "未记录";
  }
  return seconds < 60 ? `${seconds.toFixed(1)} 秒` : `${(seconds / 60).toFixed(1)} 分钟`;
}

function getTranscriptVariantLabel(variantKey: string): string {
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

function inferTranscriptVariantKey(transcript: TranscriptPayload): string {
  const engine = transcript.asr_meta?.engine?.toLowerCase() ?? "";
  if (engine.includes("sensevoice")) {
    return "sensevoice_small";
  }
  if (engine.includes("fun-asr")) {
    return "fun_asr_flash";
  }
  return "local_whisper";
}

function canShowRawVersion(transcript: TranscriptPayload | null): boolean {
  return Boolean(
    transcript &&
      ((transcript.raw_segments?.length ?? 0) > 0 || transcript.raw_plain_text?.trim())
  );
}

function getTranscriptForViewMode(
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

function TranscriptComparisonColumn({
  transcript,
  variantKey,
  viewMode
}: {
  transcript: TranscriptPayload;
  variantKey: string;
  viewMode: TranscriptViewMode;
}) {
  const visibleTranscript = getTranscriptForViewMode(transcript, viewMode);
  const meta = transcript.asr_meta;

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-950">
          {getTranscriptVariantLabel(variantKey)}
        </p>
        <p className="mt-1 break-all text-xs text-zinc-500">
          {meta?.model ?? "未记录模型"} · {meta?.device ?? "未知设备"}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-zinc-600">
          <span>识别 {formatElapsedSeconds(meta?.transcription_seconds)}</span>
          <span>校对 {formatElapsedSeconds(meta?.correction_seconds)}</span>
          <span>总计 {formatElapsedSeconds(meta?.total_seconds)}</span>
        </div>
      </header>
      <div className="max-h-[520px] overflow-auto">
        {visibleTranscript.segments.map((segment, index) => (
          <div
            className="grid gap-2 border-b border-zinc-100 px-3 py-3 last:border-b-0 sm:grid-cols-[58px_minmax(0,1fr)]"
            key={`${variantKey}-${index}-${segment.start}-${segment.end}`}
          >
            <span className="mono text-[11px] text-zinc-400">
              {formatTimestamp(segment.start)}
            </span>
            <p className="text-sm leading-6 text-zinc-700">{segment.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function getTextSourceLabel(textSourceType: string | null | undefined): string {
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

function getTranscriptSourceLabel(
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

function getTextSourceHint(
  textSourceType: string | null | undefined,
  transcript: TranscriptPayload | null
): string | null {
  if (textSourceType === "shownotes") {
    return "这是节目页公开发布的 shownotes 原文，不是完整音频对话稿。";
  }
  if (textSourceType === "asr_transcript") {
    const engineLabel = transcript
      ? getTranscriptVariantLabel(inferTranscriptVariantKey(transcript))
      : "ASR";
    if (transcript?.asr_meta?.correction_status === "corrected") {
      return `当前默认展示校对稿，可切换查看 ${engineLabel} 原始识别稿。`;
    }
    if (transcript?.asr_meta?.correction_status === "failed") {
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

function getTextSourceSlug(textSourceType: string | null | undefined): string {
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

function buildInitialTranscribeSettings(
  videoPlatform: string | null | undefined,
  mediaType: string | null | undefined
): TranscribeContextSettings {
  return getDefaultTranscribeSettings({
    platform: videoPlatform ?? "",
    media_type: mediaType ?? null
  });
}

function getHighlightSourceLabel(highlight: SummaryHighlight): string {
  if (highlight.source === "manual") {
    return "手动摘录";
  }
  if (highlight.source === "local_fallback") {
    return "基础摘录";
  }

  return "AI 摘录";
}

function sanitizeFilename(value: string): string {
  const sanitizedValue = value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();

  return sanitizedValue.slice(0, 80) || "zhilu-content-text";
}

function downloadTextFile(filename: string, text: string, type: string): void {
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

function buildDraftTextMap(highlights: SummaryHighlight[]): Record<string, string> {
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

function getVisibleSelectionRect(range: Range, root: HTMLElement): DOMRect | null {
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

function extractSelectedExcerpt(root: HTMLElement | null): SelectedExcerpt | null {
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
    .filter((part): part is { end: number | null; start: number | null; text: string } =>
      Boolean(part)
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

function buildManualHighlightFromExcerpt(
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

function normalizeCandidateHighlight(
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

function getHighlightIdentity(highlight: SummaryHighlight): string {
  return [
    highlight.source,
    highlight.start ?? "none",
    highlight.end ?? "none",
    highlight.text.trim()
  ].join("|");
}

function getHighlightTimeLabel(highlight: SummaryHighlight): string {
  if (typeof highlight.start !== "number") {
    return "未标注";
  }

  if (typeof highlight.end === "number" && highlight.end > highlight.start) {
    return `${formatTimestamp(highlight.start)} - ${formatTimestamp(highlight.end)}`;
  }

  return formatTimestamp(highlight.start);
}

function getNoteErrorMessage(error: unknown, operation: "save" | "export"): string {
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

export function TranscriptTab({
  canTranscribe,
  hasTranscript,
  isTranscribing,
  mediaType,
  noteDraft,
  sourceUrl,
  summary,
  textSourceType,
  transcribeErrorMessage,
  transcript,
  transcriptVariants,
  activeTranscriptVariant,
  videoPlatform,
  videoTitle,
  onSaveNoteDraft,
  onTranscribe
}: TranscriptTabProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [draftHighlights, setDraftHighlights] = useState<SummaryHighlight[]>(
    () => noteDraft?.highlights ?? []
  );
  const [draftEditValues, setDraftEditValues] = useState<Record<string, string>>(
    () => buildDraftTextMap(noteDraft?.highlights ?? [])
  );
  const [draftEditStatuses, setDraftEditStatuses] = useState<
    Record<string, DraftEditStatus>
  >({});
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftErrorMessage, setDraftErrorMessage] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isExportingNote, setIsExportingNote] = useState(false);
  const [selectedExcerpt, setSelectedExcerpt] = useState<SelectedExcerpt | null>(
    null
  );
  const [transcriptViewMode, setTranscriptViewMode] =
    useState<TranscriptViewMode>("final");
  const [selectedTranscriptVariant, setSelectedTranscriptVariant] =
    useState<string>(activeTranscriptVariant ?? "");
  const [isComparingTranscripts, setIsComparingTranscripts] = useState(false);
  const [transcribeSettings, setTranscribeSettings] =
    useState<TranscribeContextSettings>(() =>
      buildInitialTranscribeSettings(videoPlatform, mediaType)
    );
  const transcriptTextRootRef = useRef<HTMLElement | null>(null);
  const draftHighlightsRef = useRef<SummaryHighlight[]>(draftHighlights);
  const editSaveTimeoutsRef = useRef<Record<string, number>>({});
  const editStatusTimeoutsRef = useRef<Record<string, number>>({});
  const editRevisionRef = useRef<Record<string, number>>({});
  const lastSavedTextRef = useRef<Record<string, string>>(
    buildDraftTextMap(noteDraft?.highlights ?? [])
  );
  const isShownotes = textSourceType === "shownotes";
  const isPodcast = mediaType === "podcast";
  const normalizedTranscriptVariants = useMemo(() => {
    const variants = { ...transcriptVariants };
    if (transcript?.asr_meta && Object.keys(variants).length === 0) {
      variants[inferTranscriptVariantKey(transcript)] = transcript;
    }
    return variants;
  }, [transcript, transcriptVariants]);
  const transcriptVariantKeys = useMemo(
    () => Object.keys(normalizedTranscriptVariants),
    [normalizedTranscriptVariants]
  );
  const transcriptVariantSignature = transcriptVariantKeys.join("|");
  const selectedTranscript =
    normalizedTranscriptVariants[selectedTranscriptVariant] ?? transcript;
  const sourceLabel = getTranscriptSourceLabel(textSourceType, selectedTranscript);
  const sourceHint = getTextSourceHint(textSourceType, selectedTranscript);
  const rawSegments = selectedTranscript?.raw_segments ?? [];
  const rawPlainText = selectedTranscript?.raw_plain_text?.trim() ?? "";
  const canShowRawTranscript = Boolean(
    textSourceType === "asr_transcript" &&
      selectedTranscript &&
      (rawSegments.length > 0 || rawPlainText)
  );
  const visibleTranscript = useMemo<TranscriptPayload | null>(() => {
    if (!selectedTranscript) {
      return null;
    }
    return getTranscriptForViewMode(selectedTranscript, transcriptViewMode);
  }, [
    selectedTranscript,
    transcriptViewMode
  ]);
  const candidateHighlights = useMemo(
    () => summary?.highlights ?? [],
    [summary?.highlights]
  );
  const savedHighlightIdentities = useMemo(
    () => new Set(draftHighlights.map(getHighlightIdentity)),
    [draftHighlights]
  );

  const readSelectedExcerpt = useCallback(
    () => extractSelectedExcerpt(transcriptTextRootRef.current),
    []
  );

  useEffect(() => {
    setDraftHighlights(noteDraft?.highlights ?? []);
    const nextEditValues = buildDraftTextMap(noteDraft?.highlights ?? []);
    setDraftEditValues(nextEditValues);
    setDraftEditStatuses({});
    lastSavedTextRef.current = nextEditValues;
    setDraftMessage(null);
    setDraftErrorMessage(null);
  }, [noteDraft, sourceUrl]);

  useEffect(() => {
    draftHighlightsRef.current = draftHighlights;
  }, [draftHighlights]);

  useEffect(() => {
    setTranscriptViewMode("final");
    setSelectedExcerpt(null);
  }, [sourceUrl, transcript]);

  useEffect(() => {
    const nextVariant =
      activeTranscriptVariant && normalizedTranscriptVariants[activeTranscriptVariant]
        ? activeTranscriptVariant
        : transcriptVariantKeys[0] ?? "";
    setSelectedTranscriptVariant(nextVariant);
    setIsComparingTranscripts(false);
  }, [
    activeTranscriptVariant,
    normalizedTranscriptVariants,
    sourceUrl,
    transcriptVariantKeys,
    transcriptVariantSignature
  ]);

  useEffect(() => {
    setTranscribeSettings(buildInitialTranscribeSettings(videoPlatform, mediaType));
  }, [mediaType, sourceUrl, videoPlatform]);

  useEffect(() => {
    const handleSelectionChange = () => {
      setSelectedExcerpt(readSelectedExcerpt());
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("scroll", handleSelectionChange, true);
    window.addEventListener("resize", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("scroll", handleSelectionChange, true);
      window.removeEventListener("resize", handleSelectionChange);
    };
  }, [readSelectedExcerpt]);

  useEffect(() => {
    return () => {
      Object.values(editSaveTimeoutsRef.current).forEach(window.clearTimeout);
      Object.values(editStatusTimeoutsRef.current).forEach(window.clearTimeout);
    };
  }, []);

  const persistDraft = async (
    nextHighlights: SummaryHighlight[],
    successMessage: string
  ) => {
    if (!sourceUrl) {
      setDraftErrorMessage("当前内容没有可保存的源链接。");
      return;
    }

    const nextDraft: NoteDraft = {
      highlights: nextHighlights,
      updated_at: new Date().toISOString()
    };
    const previousHighlights = draftHighlights;
    const previousEditValues = draftEditValues;
    setDraftHighlights(nextHighlights);
    setDraftEditValues(buildDraftTextMap(nextHighlights));
    setIsSavingDraft(true);
    setDraftErrorMessage(null);
    try {
      const savedDraft = await onSaveNoteDraft(sourceUrl, nextDraft);
      setDraftHighlights(savedDraft.highlights);
      const savedEditValues = buildDraftTextMap(savedDraft.highlights);
      setDraftEditValues(savedEditValues);
      lastSavedTextRef.current = savedEditValues;
      setDraftMessage(successMessage);
      window.setTimeout(() => setDraftMessage(null), 1800);
    } catch (error) {
      setDraftHighlights(previousHighlights);
      setDraftEditValues(previousEditValues);
      setDraftErrorMessage(getNoteErrorMessage(error, "save"));
    } finally {
      setIsSavingDraft(false);
    }
  };

  const clearTranscriptSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelectedExcerpt(null);
  };

  const saveEditedHighlight = async (highlightId: string, text: string) => {
    if (!sourceUrl) {
      setDraftErrorMessage("当前内容没有可保存的源链接。");
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return;
    }
    if (trimmedText === (lastSavedTextRef.current[highlightId] ?? "").trim()) {
      return;
    }

    const revision = editRevisionRef.current[highlightId] ?? 0;
    const nextHighlights = draftHighlightsRef.current.map((highlight) =>
      highlight.id === highlightId ? { ...highlight, text: trimmedText } : highlight
    );

    setDraftEditStatuses((currentStatuses) => ({
      ...currentStatuses,
      [highlightId]: "saving"
    }));
    setDraftErrorMessage(null);

    try {
      const savedDraft = await onSaveNoteDraft(sourceUrl, {
        highlights: nextHighlights,
        updated_at: new Date().toISOString()
      });

      if ((editRevisionRef.current[highlightId] ?? 0) !== revision) {
        return;
      }

      setDraftHighlights(savedDraft.highlights);
      const savedEditValues = buildDraftTextMap(savedDraft.highlights);
      setDraftEditValues(savedEditValues);
      lastSavedTextRef.current = savedEditValues;
      setDraftEditStatuses((currentStatuses) => ({
        ...currentStatuses,
        [highlightId]: "saved"
      }));
      if (editStatusTimeoutsRef.current[highlightId]) {
        window.clearTimeout(editStatusTimeoutsRef.current[highlightId]);
      }
      editStatusTimeoutsRef.current[highlightId] = window.setTimeout(() => {
        setDraftEditStatuses((currentStatuses) => {
          const { [highlightId]: _, ...nextStatuses } = currentStatuses;
          return nextStatuses;
        });
      }, EDIT_SAVED_MESSAGE_MS);
    } catch (error) {
      setDraftEditStatuses((currentStatuses) => ({
        ...currentStatuses,
        [highlightId]: "error"
      }));
      setDraftErrorMessage(getNoteErrorMessage(error, "save"));
    }
  };

  const handleDraftTextChange = (highlightId: string, text: string) => {
    editRevisionRef.current[highlightId] =
      (editRevisionRef.current[highlightId] ?? 0) + 1;
    setDraftEditValues((currentValues) => ({
      ...currentValues,
      [highlightId]: text
    }));
    setDraftHighlights((currentHighlights) =>
      currentHighlights.map((highlight) =>
        highlight.id === highlightId ? { ...highlight, text } : highlight
      )
    );
    setDraftEditStatuses((currentStatuses) => {
      const { [highlightId]: _, ...nextStatuses } = currentStatuses;
      return nextStatuses;
    });

    if (editSaveTimeoutsRef.current[highlightId]) {
      window.clearTimeout(editSaveTimeoutsRef.current[highlightId]);
    }
    if (!text.trim()) {
      return;
    }

    editSaveTimeoutsRef.current[highlightId] = window.setTimeout(() => {
      void saveEditedHighlight(highlightId, text);
    }, EDIT_SAVE_DEBOUNCE_MS);
  };

  const handleDraftTextBlur = (highlightId: string) => {
    if (editSaveTimeoutsRef.current[highlightId]) {
      window.clearTimeout(editSaveTimeoutsRef.current[highlightId]);
    }

    const currentText = draftEditValues[highlightId] ?? "";
    if (!currentText.trim()) {
      const fallbackText = lastSavedTextRef.current[highlightId] ?? "";
      setDraftEditValues((currentValues) => ({
        ...currentValues,
        [highlightId]: fallbackText
      }));
      setDraftHighlights((currentHighlights) =>
        currentHighlights.map((highlight) =>
          highlight.id === highlightId
            ? { ...highlight, text: fallbackText }
            : highlight
        )
      );
      setDraftErrorMessage("摘录不能为空，可继续编辑或移出。");
      return;
    }
    if (
      currentText.trim() === (lastSavedTextRef.current[highlightId] ?? "").trim()
    ) {
      return;
    }

    void saveEditedHighlight(highlightId, currentText);
  };

  const resizeDraftTextarea = (element: HTMLTextAreaElement | null) => {
    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const handleCopy = async () => {
    if (!visibleTranscript) {
      return;
    }

    // NOTE: 复制纯文本能让用户直接带走内容文本，不依赖后续下载功能。
    await navigator.clipboard.writeText(visibleTranscript.plain_text);
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), 1600);
  };

  const handleExport = () => {
    if (!visibleTranscript) {
      return;
    }

    const filenameBase = sanitizeFilename(videoTitle ?? "zhilu-content-text");
    const sourceSlug = getTextSourceSlug(textSourceType);
    downloadTextFile(
      `${filenameBase}-${sourceSlug}.txt`,
      visibleTranscript.plain_text,
      "text/plain;charset=utf-8"
    );
    setHasExported(true);
    window.setTimeout(() => setHasExported(false), 1600);
  };

  const handleAddCandidate = async (highlight: SummaryHighlight) => {
    const nextHighlight = normalizeCandidateHighlight(highlight, textSourceType);
    if (savedHighlightIdentities.has(getHighlightIdentity(nextHighlight))) {
      setDraftMessage("这条摘录已经在草稿中。");
      window.setTimeout(() => setDraftMessage(null), 1600);
      return;
    }

    await persistDraft([nextHighlight, ...draftHighlights], "已加入摘录草稿。");
  };

  const handleAddSelectedExcerpt = async () => {
    const excerpt = readSelectedExcerpt() ?? selectedExcerpt;
    if (!excerpt) {
      setDraftErrorMessage("请先在正文中选中要加入摘录的文字。");
      return;
    }

    const nextHighlight = buildManualHighlightFromExcerpt(excerpt, textSourceType);
    await persistDraft([nextHighlight, ...draftHighlights], "手动摘录已保存。");
    clearTranscriptSelection();
  };

  const handleRemoveHighlight = async (highlightId: string) => {
    await persistDraft(
      draftHighlights.filter((highlight) => highlight.id !== highlightId),
      "摘录已移出草稿。"
    );
  };

  const handleExportObsidianNote = async () => {
    if (!sourceUrl) {
      setDraftErrorMessage("当前内容没有可导出的源链接。");
      return;
    }

    setIsExportingNote(true);
    setDraftErrorMessage(null);
    try {
      const response = await apiClient.exportObsidianNote({
        source_url: sourceUrl
      });
      if (!response.written_to_vault) {
        downloadTextFile(
          response.filename,
          response.markdown,
          "text/markdown;charset=utf-8"
        );
      }
      setDraftMessage(
        response.written_to_vault ? response.message : "已生成 Markdown 知识草稿。"
      );
      window.setTimeout(() => setDraftMessage(null), 2200);
    } catch (error) {
      setDraftErrorMessage(getNoteErrorMessage(error, "export"));
    } finally {
      setIsExportingNote(false);
    }
  };

  const handleTranscribeClick = () => {
    onTranscribe(transcribeSettings);
  };

  const renderTopActions = (tone: "amber" | "zinc") => {
    const borderClass = tone === "amber" ? "border-amber-200" : "border-zinc-200";
    const textClass = tone === "amber" ? "text-amber-900" : "text-zinc-700";
    const hoverClass =
      tone === "amber"
        ? "hover:border-amber-300 hover:text-zinc-950"
        : "hover:border-zinc-300 hover:text-zinc-950";

    return (
      <>
        <button
          className={`inline-flex h-10 items-center gap-2 rounded-lg border ${borderClass} bg-white px-3 text-sm font-medium ${textClass} transition-colors ${hoverClass} active:scale-[0.96]`}
          type="button"
          onClick={handleCopy}
        >
          {hasCopied ? (
            <ClipboardCheck className="h-4 w-4 text-emerald-600" />
          ) : (
            <Clipboard className="h-4 w-4" />
          )}
          {hasCopied ? "已复制" : tone === "amber" ? "复制原文" : "复制全文"}
        </button>
        <button
          className={`inline-flex h-10 items-center gap-2 rounded-lg border ${borderClass} bg-white px-3 text-sm font-medium ${textClass} transition-colors ${hoverClass} active:scale-[0.96]`}
          type="button"
          onClick={handleExport}
        >
          <FileDown
            className={`h-4 w-4 ${hasExported ? "text-emerald-600" : ""}`}
          />
          {hasExported ? "已导出" : tone === "amber" ? "导出原文" : "导出全文"}
        </button>
      </>
    );
  };

  const renderSelectionToolbar = () =>
    selectedExcerpt ? (
      <div
        className="fixed z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-blue-200 bg-white/95 px-3 py-2 text-xs font-medium text-zinc-700 shadow-[0_16px_40px_rgba(14,165,233,0.18)] backdrop-blur"
        style={{ left: selectedExcerpt.left, top: selectedExcerpt.top }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="mono tabular-nums text-blue-700">
          已选 {selectedExcerpt.charCount} 字
        </span>
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-zinc-950 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSavingDraft}
          type="button"
          onClick={() => void handleAddSelectedExcerpt()}
        >
          <Plus className="h-3.5 w-3.5" />
          加入摘录
        </button>
      </div>
    ) : null;

  const renderNoteWorkflow = () => (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">AI 摘录</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              展示总结结果中值得保留的原文表达，可加入下方草稿后再导出为知识稿。
            </p>
          </div>
          <span className="inline-flex h-7 w-fit items-center rounded-full bg-zinc-100 px-2.5 text-xs font-medium text-zinc-600">
            {candidateHighlights.length} 条摘录
          </span>
        </div>
        {candidateHighlights.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {candidateHighlights.map((highlight) => {
              const normalizedHighlight = normalizeCandidateHighlight(
                highlight,
                textSourceType
              );
              const isSaved = savedHighlightIdentities.has(
                getHighlightIdentity(normalizedHighlight)
              );

              return (
                <div
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3"
                  key={`${highlight.id}-${highlight.text}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span>{getHighlightSourceLabel(highlight)}</span>
                      </div>
                      <p className="text-sm leading-6 text-zinc-800">
                        {highlight.text}
                      </p>
                      {highlight.reason ? (
                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          {highlight.reason}
                        </p>
                      ) : null}
                    </div>
                    <button
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingDraft || isSaved}
                      type="button"
                      onClick={() => void handleAddCandidate(highlight)}
                    >
                      {isSaved ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {isSaved ? "已加入" : "加入摘录"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
            生成总结后，这里会显示可加入知识稿的摘录。
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">摘录草稿</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              框选下方原文，即可加入摘录；加入后可直接修改文字。已加入 {draftHighlights.length} 条。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
              disabled={isExportingNote || !sourceUrl}
              type="button"
              onClick={() => void handleExportObsidianNote()}
            >
              {isExportingNote ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
              {isExportingNote ? "导出中" : "导出知识草稿"}
            </button>
          </div>
        </div>

        {draftMessage ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {draftMessage}
          </div>
        ) : null}
        {draftErrorMessage ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {draftErrorMessage}
          </div>
        ) : null}

        {draftHighlights.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {draftHighlights.map((highlight) => (
              <div
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3"
                key={highlight.id}
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <Quote className="h-3.5 w-3.5" />
                      <span>{getHighlightSourceLabel(highlight)}</span>
                      {draftEditStatuses[highlight.id] === "saving" ? (
                        <span className="text-blue-600">保存中</span>
                      ) : null}
                      {draftEditStatuses[highlight.id] === "saved" ? (
                        <span className="text-emerald-600">已保存</span>
                      ) : null}
                      {draftEditStatuses[highlight.id] === "error" ? (
                        <span className="text-amber-700">保存失败</span>
                      ) : null}
                    </div>
                    <textarea
                      aria-label="编辑摘录文字"
                      className="block min-h-[64px] w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-sm leading-6 text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-200 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.08)]"
                      ref={resizeDraftTextarea}
                      rows={1}
                      value={draftEditValues[highlight.id] ?? highlight.text}
                      onBlur={() => handleDraftTextBlur(highlight.id)}
                      onChange={(event) => {
                        resizeDraftTextarea(event.currentTarget);
                        handleDraftTextChange(highlight.id, event.currentTarget.value);
                      }}
                    />
                  </div>
                  <button
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSavingDraft}
                    type="button"
                    onClick={() => void handleRemoveHighlight(highlight.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    移出
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
            在下方原文中拖拽框选文字，点击浮动按钮即可加入摘录。
          </div>
        )}
      </section>
    </div>
  );

  if (!transcript || !hasTranscript) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        <div className="flex gap-3">
          <FileAudio className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" />
          <div>
            <p className="font-medium text-zinc-950">当前没有可用内容文本。</p>
            <p className="mt-1 leading-6">
              未检测到平台字幕时，可以从公开媒体音频生成转写稿，再用于总结、摘录、导图和问答。
            </p>
          </div>
        </div>
        {canTranscribe ? (
          <>
            <TranscribeSettingsPanel
              disabled={isTranscribing}
              settings={transcribeSettings}
              onChange={setTranscribeSettings}
            />
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
              disabled={isTranscribing}
              type="button"
              onClick={handleTranscribeClick}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileAudio className="h-4 w-4" aria-hidden="true" />
              )}
              {isTranscribing ? "生成中" : "生成转写稿"}
            </button>
          </>
        ) : null}
        {transcribeErrorMessage ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {transcribeErrorMessage}
          </div>
        ) : null}
      </div>
    );
  }

  const activeTranscript = visibleTranscript ?? selectedTranscript ?? transcript;
  const preferredComparisonKeys = ["local_whisper", "sensevoice_small"].filter(
    (variantKey) => Boolean(normalizedTranscriptVariants[variantKey])
  );
  const comparisonVariantKeys =
    preferredComparisonKeys.length === 2
      ? preferredComparisonKeys
      : transcriptVariantKeys.slice(0, 2);
  const canCompareTranscripts = comparisonVariantKeys.length === 2;
  const shownotesParagraphs = activeTranscript.plain_text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ end: 0, start: 0, text: paragraph }));

  if (isShownotes) {
    return (
      <div className="space-y-4">
        {renderSelectionToolbar()}
        <section className="rounded-2xl bg-amber-50 p-4 shadow-[inset_0_0_0_1px_rgba(180,83,9,0.16)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700 shadow-[0_10px_24px_rgba(180,83,9,0.12)]">
                <BookOpenText className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-950">
                  {sourceLabel}
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  {sourceHint}
                </p>
                <p className="mt-2 text-xs leading-5 text-amber-700">
                  共 {shownotesParagraphs.length} 个原文段落。它适合快速了解节目主题；如果要按完整对话总结，请先生成转写稿。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              {isPodcast && canTranscribe ? (
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
                  disabled={isTranscribing}
                  type="button"
                  onClick={handleTranscribeClick}
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileAudio className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isTranscribing ? "生成中" : "生成转写稿"}
                </button>
              ) : null}
              {renderTopActions("amber")}
            </div>
          </div>
        </section>

        {isPodcast && canTranscribe ? (
          <TranscribeSettingsPanel
            disabled={isTranscribing}
            settings={transcribeSettings}
            onChange={setTranscribeSettings}
          />
        ) : null}

        {renderNoteWorkflow()}

        <article
          className="max-h-[500px] overflow-auto rounded-2xl bg-white px-5 py-5 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.1)]"
          ref={(element) => {
            transcriptTextRootRef.current = element;
          }}
        >
          <div className="mx-auto max-w-3xl space-y-5">
            {shownotesParagraphs.map((segment, index) => (
              <div className="group" key={`${index}-${segment.text}`}>
                <p
                  className="transcript-excerpt-text whitespace-pre-wrap text-base leading-8 text-zinc-800"
                  data-excerpt-end={segment.end}
                  data-excerpt-start={segment.start}
                  data-transcript-excerpt="true"
                >
                  {segment.text}
                </p>
              </div>
            ))}
          </div>
        </article>

        {transcribeErrorMessage ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {transcribeErrorMessage}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderSelectionToolbar()}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">
            {sourceLabel}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            共 {activeTranscript.segments.length} 个片段
          </p>
          {sourceHint ? (
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {sourceHint}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {transcriptVariantKeys.length > 1 && !isComparingTranscripts ? (
            <select
              aria-label="选择转写稿版本"
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 outline-none transition focus:border-blue-400"
              value={selectedTranscriptVariant}
              onChange={(event) => {
                setSelectedTranscriptVariant(event.target.value);
                setTranscriptViewMode("final");
              }}
            >
              {transcriptVariantKeys.map((variantKey) => (
                <option key={variantKey} value={variantKey}>
                  {getTranscriptVariantLabel(variantKey)}
                </option>
              ))}
            </select>
          ) : null}
          {canCompareTranscripts ? (
            <button
              className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
                isComparingTranscripts
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-blue-300"
              }`}
              type="button"
              onClick={() => setIsComparingTranscripts((current) => !current)}
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              {isComparingTranscripts ? "退出对比" : "并排对比"}
            </button>
          ) : null}
          {canShowRawTranscript ? (
            <div className="inline-flex h-10 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-1">
              <button
                className={`rounded-md px-2.5 text-sm font-medium transition-colors ${
                  transcriptViewMode === "final"
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                }`}
                type="button"
                onClick={() => setTranscriptViewMode("final")}
              >
                校对稿
              </button>
              <button
                className={`rounded-md px-2.5 text-sm font-medium transition-colors ${
                  transcriptViewMode === "raw"
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                }`}
                type="button"
                onClick={() => setTranscriptViewMode("raw")}
              >
                原始稿
              </button>
            </div>
          ) : null}
          {canTranscribe ? (
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isTranscribing}
              type="button"
              onClick={handleTranscribeClick}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileAudio className="h-4 w-4" aria-hidden="true" />
              )}
              {isTranscribing ? "生成中" : "重新转写"}
            </button>
          ) : null}
          {renderTopActions("zinc")}
        </div>
      </div>

      {renderNoteWorkflow()}

      {isComparingTranscripts && canCompareTranscripts ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {comparisonVariantKeys.map((variantKey) => (
            <TranscriptComparisonColumn
              key={variantKey}
              transcript={normalizedTranscriptVariants[variantKey]}
              variantKey={variantKey}
              viewMode={transcriptViewMode}
            />
          ))}
        </div>
      ) : (
        <div
          className="max-h-[460px] overflow-auto rounded-lg border border-zinc-200"
          ref={(element) => {
            transcriptTextRootRef.current = element;
          }}
        >
          {activeTranscript.segments.map((segment) => (
            <div
              className="grid gap-3 border-b border-zinc-200 bg-white px-4 py-3 last:border-b-0 sm:grid-cols-[86px_minmax(0,1fr)]"
              key={`${segment.start}-${segment.end}-${segment.speaker ?? ""}-${segment.text}`}
            >
              <div className="select-none space-y-1">
                <div className="mono text-xs text-zinc-500">
                  {formatTimestamp(segment.start)}
                </div>
                {segment.speaker ? (
                  <span className="inline-flex max-w-[76px] truncate rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {segment.speaker}
                  </span>
                ) : null}
              </div>
              <p
                className="transcript-excerpt-text text-sm leading-6 text-zinc-700"
                data-excerpt-end={segment.end}
                data-excerpt-start={segment.start}
                data-transcript-excerpt="true"
              >
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
