import {
  BrainCircuit,
  FileDown,
  GitFork,
  Loader2,
  MessageSquareText,
  ScrollText
} from "lucide-react";
import { useState } from "react";
import { useTranscriptNoteWorkflow } from "@/hooks/use-transcript-note-workflow";
import type {
  MindmapMeta,
  NoteDraft,
  SummaryDisplayState,
  SummaryGenerationMeta,
  TranscriptPayload,
  VideoSummary
} from "@/lib/types";
import { MindmapTab } from "./MindmapTab";
import { QaTab } from "./QaTab";
import { SummaryTab } from "./SummaryTab";
import { TranscriptTab } from "./TranscriptTab";

type TabKey = "summary" | "mindmap" | "qa" | "transcript";

interface AiTabsProps {
  activeTab: TabKey;
  canSummarize: boolean;
  canTranscribe: boolean;
  hasTranscript: boolean;
  isSummarizing: boolean;
  isTranscribing: boolean;
  mediaType?: string | null;
  mindmapMarkdown: string | null;
  mindmapMeta?: MindmapMeta | null;
  noteDraft?: NoteDraft | null;
  summary: VideoSummary | null;
  summaryDisplayState: SummaryDisplayState;
  summaryErrorMessage: string | null;
  summaryGenerationMeta: SummaryGenerationMeta | null;
  transcribeErrorMessage: string | null;
  transcript: TranscriptPayload | null;
  transcriptVariants: Record<string, TranscriptPayload>;
  activeTranscriptVariant?: string | null;
  textSourceType?: string | null;
  sourceUrl?: string | null;
  videoAuthor?: string | null;
  videoTitle?: string | null;
  onChangeTab: (tab: TabKey) => void;
  onQaComplete?: () => void;
  onSaveNoteDraft: (sourceUrl: string, noteDraft: NoteDraft) => Promise<NoteDraft>;
  onSummarize: () => void;
  onTranscribe: () => void;
}

const tabs: Array<{
  key: TabKey;
  label: string;
  icon: typeof BrainCircuit;
}> = [
  { key: "summary", label: "总结", icon: BrainCircuit },
  { key: "mindmap", label: "思维导图", icon: GitFork },
  { key: "qa", label: "内容问答", icon: MessageSquareText },
  { key: "transcript", label: "内容文本", icon: ScrollText }
];

export function AiTabs({
  activeTab,
  canSummarize,
  canTranscribe,
  hasTranscript,
  isSummarizing,
  isTranscribing,
  mediaType,
  mindmapMarkdown,
  mindmapMeta,
  noteDraft,
  summary,
  summaryDisplayState,
  summaryErrorMessage,
  summaryGenerationMeta,
  transcribeErrorMessage,
  transcript,
  transcriptVariants,
  activeTranscriptVariant,
  textSourceType,
  sourceUrl,
  videoAuthor,
  videoTitle,
  onChangeTab,
  onQaComplete,
  onSaveNoteDraft,
  onSummarize,
  onTranscribe
}: AiTabsProps) {
  const visibleSummary = summaryDisplayState === "empty" ? null : summary;
  const [pointQuestion, setPointQuestion] = useState<string | null>(null);
  const noteWorkflow = useTranscriptNoteWorkflow({
    noteDraft,
    sourceUrl,
    summary,
    textSourceType,
    onSaveNoteDraft
  });

  const handleAskPoint = (point: string) => {
    setPointQuestion(
      `关于这条观点：“${point}”\n依据是什么？适用于什么情况？请区分作者表达与 AI 推导。`
    );
    onChangeTab("qa");
  };

  return (
    <section className="min-w-0 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-4 sm:p-7">
      <div className="sticky top-[4.75rem] z-20 -mx-4 -mt-4 flex items-end gap-3 border-b-2 border-[var(--line-ink)] bg-[var(--paper)] px-4 pb-3 pt-4 sm:-mx-7 sm:-mt-7 sm:px-7 sm:pt-5">
        <div
          aria-label="知识稿内容视图"
          className="grid min-w-0 flex-1 grid-cols-2 gap-1 sm:flex sm:gap-2 sm:overflow-x-auto"
          role="tablist"
        >
        {tabs.map((tab, tabIndex) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;

          return (
            <button
              aria-selected={isActive}
              className={`group inline-flex min-h-10 shrink-0 items-center justify-center border-2 px-2 py-2 text-sm transition-colors duration-150 sm:justify-start sm:px-3 ${
                isActive
                  ? "border-[var(--ink)] bg-[var(--ink)] font-bold text-[var(--paper-raised)]"
                  : "border-transparent font-medium text-[var(--muted-strong)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
              }`}
              key={tab.key}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
              onClick={() => onChangeTab(tab.key)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }

                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const nextIndex = (tabIndex + direction + tabs.length) % tabs.length;
                onChangeTab(tabs[nextIndex].key);
                const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]'
                );
                tabButtons?.[nextIndex]?.focus();
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                {tab.label}
              </span>
            </button>
          );
        })}
        </div>
        <button
          className="ink-block inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-[var(--accent)] px-3 text-xs font-bold text-white hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)] disabled:text-[var(--muted)]"
          aria-label={noteWorkflow.isExportingNote ? "导出中" : "导出知识稿"}
          disabled={!sourceUrl || noteWorkflow.isExportingNote}
          type="button"
          onClick={() => void noteWorkflow.handleExportObsidianNote()}
        >
          {noteWorkflow.isExportingNote ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileDown className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {noteWorkflow.isExportingNote ? "导出中" : "导出知识稿"}
          </span>
        </button>
      </div>

      {noteWorkflow.draftMessage || noteWorkflow.draftErrorMessage ? (
        <div
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            noteWorkflow.draftErrorMessage
              ? "bg-[#f7ead9] text-[#7a4a1f]"
              : "bg-[#e9f2ea] text-[#2f5d3a]"
          }`}
        >
          {noteWorkflow.draftErrorMessage ?? noteWorkflow.draftMessage}
        </div>
      ) : null}

      <div
        aria-label={`${tabs.find((tab) => tab.key === activeTab)?.label ?? "知识稿"}内容`}
        className="mt-5 min-w-0"
        role="tabpanel"
      >
        {activeTab === "summary" ? (
          <SummaryTab
            canSummarize={canSummarize}
            canTranscribe={canTranscribe}
            hasTranscript={hasTranscript}
            isSummarizing={isSummarizing}
            isTranscribing={isTranscribing}
            mediaType={mediaType}
            summary={summary}
            summaryDisplayState={summaryDisplayState}
            summaryErrorMessage={summaryErrorMessage}
            summaryGenerationMeta={summaryGenerationMeta}
            transcribeErrorMessage={transcribeErrorMessage}
            textSourceType={textSourceType}
            transcript={transcript}
            onAskPoint={handleAskPoint}
            onSummarize={onSummarize}
            onTranscribe={onTranscribe}
          />
        ) : null}
        {activeTab === "mindmap" ? (
          <MindmapTab
            canTranscribe={canTranscribe}
            hasTranscript={hasTranscript}
            isTranscribing={isTranscribing}
            mindmapMarkdown={mindmapMarkdown}
            mindmapMeta={mindmapMeta}
            summaryDisplayState={summaryDisplayState}
            textSourceType={textSourceType}
            transcribeErrorMessage={transcribeErrorMessage}
            onTranscribe={onTranscribe}
          />
        ) : null}
        {activeTab === "qa" ? (
          <QaTab
            canTranscribe={canTranscribe}
            hasTranscript={hasTranscript}
            isTranscribing={isTranscribing}
            mediaType={mediaType}
            sourceUrl={sourceUrl}
            summary={visibleSummary}
            transcribeErrorMessage={transcribeErrorMessage}
            textSourceType={textSourceType}
            transcript={transcript}
            videoAuthor={videoAuthor}
            videoTitle={videoTitle}
            contextualQuestion={pointQuestion}
            onQaComplete={onQaComplete}
            onTranscribe={onTranscribe}
          />
        ) : null}
        {activeTab === "transcript" ? (
          <TranscriptTab
            canTranscribe={canTranscribe}
            hasTranscript={hasTranscript}
            isTranscribing={isTranscribing}
            mediaType={mediaType}
            noteWorkflow={noteWorkflow}
            sourceUrl={sourceUrl}
            transcribeErrorMessage={transcribeErrorMessage}
            textSourceType={textSourceType}
            transcript={transcript}
            transcriptVariants={transcriptVariants}
            activeTranscriptVariant={activeTranscriptVariant}
            videoTitle={videoTitle}
            onTranscribe={onTranscribe}
          />
        ) : null}
      </div>
    </section>
  );
}
