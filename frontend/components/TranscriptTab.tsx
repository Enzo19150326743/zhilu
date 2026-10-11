"use client";

import {
  BookOpenText,
  Clipboard,
  ClipboardCheck,
  FileAudio,
  FileDown,
  Loader2,
  Plus,
  Search
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TranscriptNoteWorkflowState } from "@/hooks/use-transcript-note-workflow";
import type { TranscriptPayload } from "@/lib/types";
import { IconActionButton } from "./IconActionButton";
import { TranscriptNoteWorkflow } from "./TranscriptNoteWorkflow";
import { TranscribeRequiredState } from "./TranscribeRequiredState";
import {
  downloadTextFile,
  formatTimestamp,
  getTextSourceHint,
  getTextSourceSlug,
  getTranscriptSourceLabel,
  sanitizeFilename
} from "@/lib/transcript-workbench";

interface TranscriptTabProps {
  canTranscribe: boolean;
  hasTranscript: boolean;
  isTranscribing: boolean;
  mediaType?: string | null;
  noteWorkflow: TranscriptNoteWorkflowState;
  sourceUrl?: string | null;
  textSourceType?: string | null;
  transcribeErrorMessage: string | null;
  transcript: TranscriptPayload | null;
  videoTitle?: string | null;
  onTranscribe: () => void;
}
export function TranscriptTab({
  canTranscribe,
  hasTranscript,
  isTranscribing,
  mediaType,
  noteWorkflow,
  sourceUrl,
  textSourceType,
  transcribeErrorMessage,
  transcript,
  videoTitle,
  onTranscribe
}: TranscriptTabProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const [hasExported, setHasExported] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState("");
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
    handleExcerptPointerDown,
    handleExcerptPointerUp,
    handleRemoveHighlight,
    isSavingDraft,
    recentlyAddedHighlightId,
    savedHighlightIdentities,
    selectedExcerpt,
    transcriptTextRootRef
  } = noteWorkflow;
  const isShownotes = textSourceType === "shownotes";
  const isPodcast = mediaType === "podcast";
  const sourceLabel = getTranscriptSourceLabel(textSourceType, transcript);
  const sourceHint = getTextSourceHint(textSourceType, transcript);
  const activeTranscript = transcript;
  useEffect(() => {
    setTranscriptQuery("");
  }, [sourceUrl, transcript]);

  const handleCopy = async () => {
    if (!activeTranscript) {
      return;
    }

    // NOTE: 复制纯文本能让用户直接带走内容文本，不依赖后续下载功能。
    await navigator.clipboard.writeText(activeTranscript.plain_text);
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), 1600);
  };

  const handleExport = () => {
    if (!activeTranscript) {
      return;
    }

    const filenameBase = sanitizeFilename(videoTitle ?? "zhilu-content-text");
    const sourceSlug = getTextSourceSlug(textSourceType);
    downloadTextFile(
      `${filenameBase}-${sourceSlug}.txt`,
      activeTranscript.plain_text,
      "text/plain;charset=utf-8"
    );
    setHasExported(true);
    window.setTimeout(() => setHasExported(false), 1600);
  };

  const renderTopActions = (sourceKind: "shownotes" | "transcript") => {
    return (
      <>
        <IconActionButton
          icon={hasCopied ? ClipboardCheck : Clipboard}
          label={
            hasCopied
              ? "全文已复制"
              : sourceKind === "shownotes"
                ? "复制公开笔记"
                : "复制全文"
          }
          tone={hasCopied ? "accent" : "default"}
          onClick={() => void handleCopy()}
        />
        <IconActionButton
          icon={FileDown}
          label={
            hasExported
              ? "全文已导出"
              : sourceKind === "shownotes"
                ? "导出公开笔记"
                : "导出全文"
          }
          tone={hasExported ? "accent" : "default"}
          onClick={handleExport}
        />
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
          加入整理
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
      isSavingDraft={isSavingDraft}
      recentlyAddedHighlightId={recentlyAddedHighlightId}
      savedHighlightIdentities={savedHighlightIdentities}
      textSourceType={textSourceType}
      onAddCandidate={(highlight) => void handleAddCandidate(highlight)}
      onDraftTextBlur={handleDraftTextBlur}
      onDraftTextChange={handleDraftTextChange}
      onRemoveHighlight={(highlightId) => void handleRemoveHighlight(highlightId)}
    />
  );

  if (!activeTranscript || !hasTranscript) {
    return (
      <div className="space-y-4">
        <TranscribeRequiredState
          canTranscribe={canTranscribe}
          description="未检测到平台字幕时，可以从公开媒体音频生成转写稿，再用于总结、摘录、导图和问答。"
          isTranscribing={isTranscribing}
          title="当前没有可用内容文本"
          onTranscribe={onTranscribe}
        />
        {transcribeErrorMessage ? (
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
            {transcribeErrorMessage}
          </div>
        ) : null}
      </div>
    );
  }

  const shownotesParagraphs = activeTranscript.plain_text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ end: 0, start: 0, text: paragraph }));
  const normalizedTranscriptQuery = transcriptQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleSegments = normalizedTranscriptQuery
    ? activeTranscript.segments.filter((segment) =>
        segment.text.toLocaleLowerCase("zh-CN").includes(normalizedTranscriptQuery)
      )
    : activeTranscript.segments;

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
                  onClick={onTranscribe}
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileAudio className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isTranscribing ? "生成中" : "生成转写稿"}
                </button>
              ) : null}
              {renderTopActions("shownotes")}
            </div>
          </div>
        </section>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.48fr)] lg:items-start">
          <article
            className="min-w-0 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-5 py-5"
            onPointerDown={handleExcerptPointerDown}
            onPointerUp={handleExcerptPointerUp}
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
          {renderNoteWorkflow()}
        </div>

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
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.48fr)] lg:items-start">
        <div className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-4 select-none">
            <div>
              <h3 className="font-editorial text-xl font-bold leading-7 text-[var(--ink)]">
                原文
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                选中文本，加入我的整理。
              </p>
              {sourceHint ? (
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {sourceHint}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {renderTopActions("transcript")}
            </div>
          </div>
          <label className="relative mb-3 block select-none">
            <span className="sr-only">搜索并定位原文</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
            />
            <input
              className="h-10 w-full border border-[var(--line-strong)] bg-[var(--paper)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="输入关键词，定位原文"
              type="search"
              value={transcriptQuery}
              onChange={(event) => setTranscriptQuery(event.target.value)}
            />
          </label>
          <div
            className="rounded-[2px] border border-[var(--line-strong)]"
            onPointerDown={handleExcerptPointerDown}
            onPointerUp={handleExcerptPointerUp}
            ref={(element) => {
              transcriptTextRootRef.current = element;
            }}
          >
            {visibleSegments.length > 0 ? (
              visibleSegments.map((segment) => (
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
              ))
            ) : (
              <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                没有找到包含“{transcriptQuery.trim()}”的片段。
              </div>
            )}
          </div>
        </div>
        {renderNoteWorkflow()}
      </div>
    </div>
  );
}
