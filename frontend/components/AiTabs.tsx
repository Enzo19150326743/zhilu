import { BrainCircuit, GitFork, MessageSquareText, ScrollText } from "lucide-react";
import type {
  MindmapMeta,
  NoteDraft,
  SummaryDisplayState,
  SummaryGenerationMeta,
  TranscribeContextSettings,
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
  summaryNotice: string | null;
  transcribeErrorMessage: string | null;
  transcript: TranscriptPayload | null;
  transcriptVariants: Record<string, TranscriptPayload>;
  activeTranscriptVariant?: string | null;
  textSourceType?: string | null;
  sourceUrl?: string | null;
  videoAuthor?: string | null;
  videoPlatform?: string | null;
  videoTitle?: string | null;
  onChangeTab: (tab: TabKey) => void;
  onQaComplete?: () => void;
  onSaveNoteDraft: (sourceUrl: string, noteDraft: NoteDraft) => Promise<NoteDraft>;
  onSummarize: () => void;
  onTranscribe: (settings?: TranscribeContextSettings) => void;
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
  summaryNotice,
  transcribeErrorMessage,
  transcript,
  transcriptVariants,
  activeTranscriptVariant,
  textSourceType,
  sourceUrl,
  videoAuthor,
  videoPlatform,
  videoTitle,
  onChangeTab,
  onQaComplete,
  onSaveNoteDraft,
  onSummarize,
  onTranscribe
}: AiTabsProps) {
  const visibleSummary = summaryDisplayState === "empty" ? null : summary;

  return (
    <section className="min-w-0 rounded-[24px] bg-[var(--paper-raised)] p-4 shadow-[var(--shadow-paper)] sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Knowledge draft
        </span>
        <span className="h-px flex-1 bg-[var(--line-strong)]" />
      </div>
      <div
        aria-label="知识稿内容视图"
        className="flex gap-1 overflow-x-auto border-b border-[var(--line-strong)] pb-0"
        role="tablist"
      >
        {tabs.map((tab, tabIndex) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;

          return (
            <button
              aria-selected={isActive}
              className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-[color,background-color,scale] duration-150 active:scale-[0.96] ${
                isActive
                  ? "text-[var(--ink)]"
                  : "text-[var(--muted)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
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
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
              {isActive ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[var(--accent)]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        aria-label={`${tabs.find((tab) => tab.key === activeTab)?.label ?? "知识稿"}内容`}
        className="mt-6 min-w-0"
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
            summaryNotice={summaryNotice}
            transcribeErrorMessage={transcribeErrorMessage}
            textSourceType={textSourceType}
            onSummarize={onSummarize}
            onTranscribe={onTranscribe}
          />
        ) : null}
        {activeTab === "mindmap" ? (
          <MindmapTab
            mindmapMarkdown={mindmapMarkdown}
            mindmapMeta={mindmapMeta}
            summaryDisplayState={summaryDisplayState}
          />
        ) : null}
        {activeTab === "qa" ? (
          <QaTab
            canTranscribe={canTranscribe}
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
            videoPlatform={videoPlatform}
            videoTitle={videoTitle}
            onSaveNoteDraft={onSaveNoteDraft}
            onTranscribe={onTranscribe}
          />
        ) : null}
      </div>
    </section>
  );
}
