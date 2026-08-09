import { FileAudio, FileText, Loader2 } from "lucide-react";
import { SafeMarkdown } from "./SafeMarkdown";
import type {
  SummaryDisplayState,
  SummaryGenerationMeta,
  VideoSummary
} from "@/lib/types";

interface SummaryTabProps {
  canSummarize: boolean;
  canTranscribe: boolean;
  hasTranscript: boolean;
  isSummarizing: boolean;
  isTranscribing: boolean;
  mediaType?: string | null;
  summary: VideoSummary | null;
  summaryDisplayState: SummaryDisplayState;
  summaryErrorMessage: string | null;
  summaryNotice: string | null;
  summaryGenerationMeta: SummaryGenerationMeta | null;
  transcribeErrorMessage: string | null;
  textSourceType?: string | null;
  onSummarize: () => void;
  onTranscribe: () => void;
}

interface SummaryEmptyStateProps {
  canSummarize: boolean;
  canTranscribe: boolean;
  hasTranscript: boolean;
  isShownotesSource: boolean;
  isSummarizing: boolean;
  isTranscribing: boolean;
  onSummarize: () => void;
  onTranscribe: () => void;
}

interface SummarySectionHeadingProps {
  index: string;
  label: string;
  title: string;
}

function SummarySectionHeading({
  index,
  label,
  title
}: SummarySectionHeadingProps) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent)]">
        {index} / {label}
      </p>
      <h3 className="font-editorial mt-1 text-xl font-semibold text-[var(--ink)]">
        {title}
      </h3>
    </div>
  );
}

function SummaryEmptyState({
  canSummarize,
  canTranscribe,
  hasTranscript,
  isShownotesSource,
  isSummarizing,
  isTranscribing,
  onSummarize,
  onTranscribe
}: SummaryEmptyStateProps) {
  const canUseTranscribeAction = canTranscribe || isTranscribing;
  const description = isShownotesSource
    ? "当前只有节目页 shownotes 原文，不是完整音频对话稿。必须先生成转写稿，再基于完整逐字稿总结。"
    : hasTranscript
      ? isSummarizing
        ? "内容文本已就绪，正在生成结构化总结。"
        : "内容文本已就绪，可以生成结构化总结。"
      : canUseTranscribeAction
        ? isTranscribing
          ? "正在生成转写稿，完成后会继续整理总结。"
          : "需要先生成转写稿，再整理总结。"
        : "当前内容暂时无法生成总结。";
  const title = isShownotesSource
    ? "未生成对话稿总结"
    : isSummarizing
      ? "正在生成总结"
      : "未生成总结";
  const action =
    isShownotesSource && canUseTranscribeAction
      ? {
          disabled: isTranscribing,
          icon: FileAudio,
          isRunning: isTranscribing,
          label: isTranscribing ? "生成中" : "生成转写稿",
          onClick: onTranscribe
        }
      : canSummarize
        ? {
            disabled: isSummarizing,
            icon: FileText,
            isRunning: isSummarizing,
            label: isSummarizing ? "生成中" : "生成总结",
            onClick: onSummarize
          }
        : canUseTranscribeAction
          ? {
              disabled: isTranscribing,
              icon: FileAudio,
              isRunning: isTranscribing,
              label: isTranscribing ? "生成中" : "生成转写稿",
              onClick: onTranscribe
            }
          : null;
  const ActionIcon = action?.icon ?? FileText;

  return (
    <section className="shadow-hard-md relative min-h-[300px] overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper)] px-6 py-8 sm:px-8 sm:py-10">
      <div className="relative flex min-h-[220px] flex-col justify-between">
        <div>
          <span className="shadow-hard-sm mono inline-flex min-h-8 items-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent)] px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--paper-raised)]">
            {isShownotesSource ? "已读取 shownotes" : "内容已提取"}
          </span>
          <h3 className="font-editorial mt-8 text-balance text-3xl font-bold tracking-normal text-[var(--ink)] sm:text-4xl">
            {title}
          </h3>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            {description}
          </p>
        </div>

        {action ? (
          <button
            className="ink-block mt-8 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-[2px] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-65"
            disabled={action.disabled}
            type="button"
            onClick={action.onClick}
          >
            {action.isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ActionIcon className="h-4 w-4" aria-hidden="true" />
            )}
            {action.label}
          </button>
        ) : null}

      </div>
    </section>
  );
}

export function SummaryTab({
  canSummarize,
  canTranscribe,
  hasTranscript,
  isSummarizing,
  isTranscribing,
  mediaType,
  summary,
  summaryDisplayState,
  summaryErrorMessage,
  summaryNotice,
  summaryGenerationMeta,
  transcribeErrorMessage,
  textSourceType,
  onSummarize,
  onTranscribe
}: SummaryTabProps) {
  const isShownotes = textSourceType === "shownotes";
  const isPodcast = mediaType === "podcast";

  if (summaryDisplayState === "empty") {
    return (
      <div className="space-y-4">
        <SummaryEmptyState
          canSummarize={canSummarize}
          canTranscribe={canTranscribe}
          hasTranscript={hasTranscript}
          isShownotesSource={isPodcast && isShownotes}
          isSummarizing={isSummarizing}
          isTranscribing={isTranscribing}
          onSummarize={onSummarize}
          onTranscribe={onTranscribe}
        />

        {transcribeErrorMessage ? (
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
            {transcribeErrorMessage}
          </div>
        ) : null}

        {summaryErrorMessage ? (
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
            {summaryErrorMessage}
          </div>
        ) : null}

        {summaryNotice ? (
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#e9f2ea] px-3 py-2 text-sm text-[#2f5d3a]">
            {summaryNotice}
          </div>
        ) : null}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-[2px] border border-dashed border-[var(--line-strong)] bg-[var(--paper-deep)] p-6 text-sm text-[var(--muted)]">
        暂无总结内容。
      </div>
    );
  }

  const topicTags = Array.from(
    new Set([...(summary.topics ?? []), ...(summary.content_keywords ?? [])])
  ).filter(Boolean);
  const applicationClues =
    summary.application_clues?.length
      ? summary.application_clues
      : summary.takeaways;

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 border-b-2 border-[var(--line-ink)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="font-editorial text-lg font-semibold text-[var(--ink)]">结构化总结</h3>
            <span
              className={`mono inline-flex items-center rounded-[2px] border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${
                summaryGenerationMeta
                  ? summaryGenerationMeta.isAiGenerated
                    ? "border-[var(--line-ink)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--line-ink)] bg-[#f7ead9] text-[#7a4a1f]"
                  : "border-[var(--line-strong)] text-[var(--muted)]"
              }`}
            >
              {summaryDisplayState === "demo"
                ? "推荐摘要"
                : summaryGenerationMeta?.isAiGenerated
                  ? "AI 生成"
                  : "基础摘要"}
            </span>
          </div>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-[var(--muted)]">
            一份可以继续编辑、摘录和导出的媒体知识提纲。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className="ink-block inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSummarize || isSummarizing}
            type="button"
            onClick={onSummarize}
          >
            {isSummarizing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            {isSummarizing
              ? "生成中"
              : summaryDisplayState === "generated"
                ? "重新生成知识稿"
                : "生成知识稿"}
          </button>
        </div>
      </section>

      {!hasTranscript ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-4 py-3 text-sm leading-6 text-[#7a4a1f]">
          <div>
            <p className="font-medium">当前没有可用于总结的内容文本。</p>
            <p className="mt-1">
              可以先生成转写稿，再整理总结、摘录和导图。
            </p>
            {canTranscribe ? (
              <button
                className="ink-block mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-60"
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
          </div>
        </div>
      ) : null}

      {transcribeErrorMessage ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
          {transcribeErrorMessage}
        </div>
      ) : null}

      {isPodcast && isShownotes ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent-soft)] px-3 py-3 text-sm leading-6 text-[var(--ink)]">
          <p>
            当前只有 shownotes 原文，不是完整音频对话稿；必须先生成转写稿，才能继续总结、摘录和导图。
          </p>
          {canTranscribe ? (
            <button
              className="ink-block mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>
      ) : null}

      {summaryErrorMessage ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
          {summaryErrorMessage}
        </div>
      ) : null}

      {summaryNotice ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#e9f2ea] px-3 py-2 text-sm text-[#2f5d3a]">
          {summaryNotice}
        </div>
      ) : null}

      <section className="flex gap-4 px-1 py-2">
        <span aria-hidden="true" className="w-[5px] shrink-0 bg-[var(--accent)]" />
        <p className="font-editorial text-pretty text-lg font-medium leading-8 text-[var(--ink)] sm:text-[19px] sm:leading-[32px]">
          {summary.tldr}
        </p>
      </section>

      {topicTags.length > 0 ? (
        <section className="flex flex-wrap gap-2 border-b border-[var(--line-ink)] pb-5">
          {topicTags.map((topic) => (
            <span
              className="inline-flex min-h-7 items-center rounded-[2px] border-[1.5px] border-[var(--line-ink)] bg-transparent px-2.5 text-xs font-normal text-[var(--ink)]"
              key={topic}
            >
              {topic}
            </span>
          ))}
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[140px_1fr] lg:gap-8">
        <SummarySectionHeading index="02" label="观点" title="核心观点" />
        <ol className="border-t border-[var(--line-strong)]">
          {summary.key_points.map((point, index) => (
            <li
              className="grid grid-cols-[46px_1fr] gap-3 border-b border-[var(--line)] py-4 sm:grid-cols-[58px_1fr] sm:py-5"
              key={point}
            >
              <span className="font-editorial tabular-nums text-lg font-bold leading-7 text-[var(--accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-pretty text-sm leading-7 text-[var(--ink-soft)] sm:text-[15px]">
                {point}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {summary.structured_analysis_markdown.trim() ? (
        <section className="grid gap-5 border-y border-[var(--line-strong)] py-6 lg:grid-cols-[140px_1fr] lg:gap-8">
          <SummarySectionHeading
            index="03"
            label="深度笔记"
            title="结构化分析"
          />
          <SafeMarkdown markdown={summary.structured_analysis_markdown} />
        </section>
      ) : null}

      {summary.timeline.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {isShownotes ? "笔记线索" : "结构线索"}
          </h3>
          <div className="mt-3 border-y border-[var(--line-strong)]">
            {summary.timeline.map((item, index) => (
              <div
                className="grid grid-cols-[76px_1fr] border-b border-[var(--line)] last:border-b-0 even:bg-[var(--paper-deep)]/35"
                key={`${item.time}-${item.content}`}
              >
                <div className="mono px-3 py-3 text-xs text-[var(--muted)]">
                  {isShownotes ? `笔记 ${index + 1}` : item.time}
                </div>
                <div className="border-l border-[var(--line)] px-3 py-3 text-sm leading-6 text-[var(--ink-soft)]">
                  {item.content}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[140px_1fr] lg:gap-8">
        <SummarySectionHeading index="04" label="行动" title="可行动建议" />
        <ol className="grid border-t border-[var(--line-strong)] sm:grid-cols-2">
          {applicationClues.map((item, index) => (
            <li
              className="grid min-h-24 grid-cols-[34px_1fr] gap-3 border-b border-[var(--line)] py-4 sm:odd:pr-5 sm:even:border-l sm:even:pl-5"
              key={item}
            >
              <span className="font-editorial tabular-nums text-base font-bold text-[var(--accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-pretty text-sm leading-6 text-[var(--ink-soft)]">
                {item}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {summary.content_boundaries?.length ? (
        <section className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-4 py-4">
          <h3 className="text-sm font-semibold text-[#6b3f1a]">内容边界与待核实项</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-[#7a4a1f]">
            {summary.content_boundaries.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
