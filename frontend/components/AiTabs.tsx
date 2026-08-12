import { BrainCircuit, GitFork, MessageSquareText, ScrollText } from "lucide-react";
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

  return (
    <section className="shadow-hard-lg min-w-0 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-4 sm:p-7">
      <div
        aria-label="知识稿内容视图"
        className="sticky top-[4.75rem] z-20 -mx-4 -mt-4 flex gap-6 overflow-x-auto border-b-2 border-[var(--line-ink)] bg-[var(--paper-raised)] px-4 pb-3 pt-4 sm:-mx-7 sm:-mt-7 sm:px-7 sm:pt-5"
        role="tablist"
      >
        {tabs.map((tab, tabIndex) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;

          return (
            <button
              aria-selected={isActive}
              className={`group inline-flex shrink-0 flex-col gap-1.5 pb-1 text-sm transition-colors duration-150 ${
                isActive
                  ? "font-semibold text-[var(--ink)]"
                  : "font-normal text-[var(--muted)] hover:text-[var(--ink)]"
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
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </span>
              <span
                aria-hidden="true"
                className={`h-[3px] w-full ${
                  isActive
                    ? "bg-[var(--accent)]"
                    : "bg-transparent group-hover:bg-[var(--line-strong)]"
                }`}
              />
            </button>
          );
        })}
      </div>

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
            noteDraft={noteDraft}
            sourceUrl={sourceUrl}
            summary={summary}
            transcribeErrorMessage={transcribeErrorMessage}
            textSourceType={textSourceType}
            transcript={transcript}
            transcriptVariants={transcriptVariants}
            activeTranscriptVariant={activeTranscriptVariant}
            videoTitle={videoTitle}
            onSaveNoteDraft={onSaveNoteDraft}
            onTranscribe={onTranscribe}
          />
        ) : null}
      </div>
    </section>
  );
}
