"use client";

import {
  BookOpenText,
  Clipboard,
  ClipboardCheck,
  FileAudio,
  FileDown,
  GitCompareArrows,
  Loader2,
  Plus
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranscriptNoteWorkflow } from "@/hooks/use-transcript-note-workflow";
import type {
  NoteDraft,
  TranscribeContextSettings,
  TranscriptPayload,
  VideoSummary
} from "@/lib/types";
import { TranscriptComparisonColumn } from "./TranscriptComparisonColumn";
import { TranscriptNoteWorkflow } from "./TranscriptNoteWorkflow";
import { TranscribeSettingsPanel } from "./TranscribeSettingsPanel";
import {
  buildInitialTranscribeSettings,
  downloadTextFile,
  formatTimestamp,
  getTextSourceHint,
  getTextSourceSlug,
  getTranscriptForViewMode,
  getTranscriptSourceLabel,
  getTranscriptVariantLabel,
  inferTranscriptVariantKey,
  sanitizeFilename,
  type TranscriptViewMode
} from "@/lib/transcript-workbench";

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
  const [transcriptViewMode, setTranscriptViewMode] =
    useState<TranscriptViewMode>("final");
  const [selectedTranscriptVariant, setSelectedTranscriptVariant] =
    useState<string>(activeTranscriptVariant ?? "");
  const [isComparingTranscripts, setIsComparingTranscripts] = useState(false);
  const [transcribeSettings, setTranscribeSettings] =
    useState<TranscribeContextSettings>(() =>
      buildInitialTranscribeSettings(videoPlatform, mediaType)
    );
  const {
    candidateHighlights,
    draftEditStatuses,
    draftEditValues,
    draftErrorMessage,
    draftHighlights,
    draftMessage,
    handleAddCandidate,
    handleAddSelectedExcerpt,
    handleDraftTextBlur,
    handleDraftTextChange,
    handleExportObsidianNote,
    handleRemoveHighlight,
    isExportingNote,
    isSavingDraft,
    savedHighlightIdentities,
    selectedExcerpt,
    transcriptTextRootRef
  } = useTranscriptNoteWorkflow({
    noteDraft,
    sourceUrl,
    summary,
    textSourceType,
    onSaveNoteDraft
  });
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
  useEffect(() => {
    setTranscriptViewMode("final");
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

  const handleTranscribeClick = () => {
    onTranscribe(transcribeSettings);
  };

  const renderTopActions = (tone: "amber" | "zinc") => {
    const borderClass = tone === "amber" ? "border-[var(--line-ink)]" : "border-[var(--line-strong)]";
    const textClass = tone === "amber" ? "text-[#7a4a1f]" : "text-[var(--ink-soft)]";
    const hoverClass =
      tone === "amber"
        ? "hover:border-[var(--line-ink)] hover:text-[var(--ink)]"
        : "hover:border-[var(--line-strong)] hover:text-[var(--ink)]";

    return (
      <>
        <button
          className={`inline-flex h-10 items-center gap-2 rounded-[2px] border ${borderClass} bg-[var(--paper-raised)] px-3 text-sm font-medium ${textClass} transition-colors ${hoverClass} active:scale-[0.96]`}
          type="button"
          onClick={handleCopy}
        >
          {hasCopied ? (
            <ClipboardCheck className="h-4 w-4 text-[#2f5d3a]" />
          ) : (
            <Clipboard className="h-4 w-4" />
          )}
          {hasCopied ? "已复制" : tone === "amber" ? "复制原文" : "复制全文"}
        </button>
        <button
          className={`inline-flex h-10 items-center gap-2 rounded-[2px] border ${borderClass} bg-[var(--paper-raised)] px-3 text-sm font-medium ${textClass} transition-colors ${hoverClass} active:scale-[0.96]`}
          type="button"
          onClick={handleExport}
        >
          <FileDown
            className={`h-4 w-4 ${hasExported ? "text-[#2f5d3a]" : ""}`}
          />
          {hasExported ? "已导出" : tone === "amber" ? "导出原文" : "导出全文"}
        </button>
      </>
    );
  };

  const renderSelectionToolbar = () =>
    selectedExcerpt ? (
      <div
        className="fixed z-50 flex -translate-x-1/2 items-center gap-2 rounded-[2px] border border-[var(--line-ink)] bg-[var(--paper-raised)]/95 px-3 py-2 text-xs font-medium text-[var(--ink-soft)] shadow-[0_16px_40px_rgba(33,29,23,0.16)] backdrop-blur"
        style={{ left: selectedExcerpt.left, top: selectedExcerpt.top }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="mono tabular-nums text-[var(--accent)]">
          已选 {selectedExcerpt.charCount} 字
        </span>
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[2px] bg-[var(--ink)] px-3 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60"
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
    <TranscriptNoteWorkflow
      candidateHighlights={candidateHighlights}
      draftEditStatuses={draftEditStatuses}
      draftEditValues={draftEditValues}
      draftErrorMessage={draftErrorMessage}
      draftHighlights={draftHighlights}
      draftMessage={draftMessage}
      isExportingNote={isExportingNote}
      isSavingDraft={isSavingDraft}
      savedHighlightIdentities={savedHighlightIdentities}
      sourceUrl={sourceUrl}
      textSourceType={textSourceType}
      onAddCandidate={(highlight) => void handleAddCandidate(highlight)}
      onDraftTextBlur={handleDraftTextBlur}
      onDraftTextChange={handleDraftTextChange}
      onExportNote={() => void handleExportObsidianNote()}
      onRemoveHighlight={(highlightId) => void handleRemoveHighlight(highlightId)}
    />
  );

  if (!transcript || !hasTranscript) {
    return (
      <div className="space-y-3 rounded-[2px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] p-6 text-sm text-[var(--muted-strong)]">
        <div className="flex gap-3">
          <FileAudio className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted)]" />
          <div>
            <p className="font-medium text-[var(--ink)]">当前没有可用内容文本。</p>
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
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
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
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
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
        <section className="rounded-[2px] bg-[#f7ead9] p-4 shadow-[inset_0_0_0_1px_rgba(180,83,9,0.16)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] bg-[var(--paper-raised)] text-[#7a4a1f] shadow-[0_10px_24px_rgba(180,83,9,0.12)]">
                <BookOpenText className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#6b3f1a]">
                  {sourceLabel}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#7a4a1f]">
                  {sourceHint}
                </p>
                <p className="mt-2 text-xs leading-5 text-[#7a4a1f]">
                  共 {shownotesParagraphs.length} 个原文段落。它适合快速了解节目主题；如果要按完整对话总结，请先生成转写稿。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              {isPodcast && canTranscribe ? (
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[var(--accent-deep)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
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
          className="max-h-[500px] overflow-auto rounded-[2px] bg-[var(--paper-raised)] px-5 py-5 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.1)]"
          ref={(element) => {
            transcriptTextRootRef.current = element;
          }}
        >
          <div className="mx-auto max-w-3xl space-y-5">
            {shownotesParagraphs.map((segment, index) => (
              <div className="group" key={`${index}-${segment.text}`}>
                <p
                  className="transcript-excerpt-text whitespace-pre-wrap text-base leading-8 text-[var(--ink-soft)]"
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
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
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
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {sourceLabel}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            共 {activeTranscript.segments.length} 个片段
          </p>
          {sourceHint ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {sourceHint}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {transcriptVariantKeys.length > 1 && !isComparingTranscripts ? (
            <select
              aria-label="选择转写稿版本"
              className="h-10 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 text-sm font-medium text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)]"
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
              className={`inline-flex h-10 items-center gap-2 rounded-[2px] border px-3 text-sm font-medium transition ${
                isComparingTranscripts
                  ? "border-[var(--line-ink)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:border-[var(--accent)]"
              }`}
              type="button"
              onClick={() => setIsComparingTranscripts((current) => !current)}
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              {isComparingTranscripts ? "退出对比" : "并排对比"}
            </button>
          ) : null}
          {canShowRawTranscript ? (
            <div className="inline-flex h-10 overflow-hidden rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] p-1">
              <button
                className={`rounded-[2px] px-2.5 text-sm font-medium transition-colors ${
                  transcriptViewMode === "final"
                    ? "bg-[var(--paper-raised)] text-[var(--ink)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink-soft)]"
                }`}
                type="button"
                onClick={() => setTranscriptViewMode("final")}
              >
                校对稿
              </button>
              <button
                className={`rounded-[2px] px-2.5 text-sm font-medium transition-colors ${
                  transcriptViewMode === "raw"
                    ? "bg-[var(--paper-raised)] text-[var(--ink)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink-soft)]"
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
              className="inline-flex h-10 items-center gap-2 rounded-[2px] bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60"
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
          className="max-h-[460px] overflow-auto rounded-[2px] border border-[var(--line-strong)]"
          ref={(element) => {
            transcriptTextRootRef.current = element;
          }}
        >
          {activeTranscript.segments.map((segment) => (
            <div
              className="grid gap-3 border-b border-[var(--line-strong)] bg-[var(--paper-raised)] px-4 py-3 last:border-b-0 sm:grid-cols-[86px_minmax(0,1fr)]"
              key={`${segment.start}-${segment.end}-${segment.speaker ?? ""}-${segment.text}`}
            >
              <div className="select-none space-y-1">
                <div className="mono text-xs text-[var(--muted)]">
                  {formatTimestamp(segment.start)}
                </div>
                {segment.speaker ? (
                  <span className="inline-flex max-w-[76px] truncate rounded-[2px] bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                    {segment.speaker}
                  </span>
                ) : null}
              </div>
              <p
                className="transcript-excerpt-text text-sm leading-6 text-[var(--ink-soft)]"
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
