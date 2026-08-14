import { FileAudio, FileText, Loader2 } from "lucide-react";
import { SafeMarkdown } from "./SafeMarkdown";
import { TranscribeRequiredState } from "./TranscribeRequiredState";
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
  summaryGenerationMeta: SummaryGenerationMeta | null;
  transcribeErrorMessage: string | null;
  textSourceType?: string | null;
  onSummarize: () => void;
  onTranscribe: () => void;
}

interface SummaryEmptyStateProps {
  canSummarize: boolean;
  isSummarizing: boolean;
  onSummarize: () => void;
}

interface SummarySectionHeadingProps {
  title: string;
}

function SummarySectionHeading({ title }: SummarySectionHeadingProps) {
  return (
    <div className="flex items-center gap-3 lg:block">
      <span className="block h-1 w-6 bg-[var(--accent)] lg:mb-3" aria-hidden="true" />
      <h3 className="font-editorial text-xl font-semibold text-[var(--ink)]">
        {title}
      </h3>
    </div>
  );
}

function getTopicIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·_\-/]+/gu, "");
}

function getTopicTags(summary: VideoSummary): string[] {
  const seenTopicIdentities = new Set<string>();
  const topicTags: string[] = [];

  for (const topic of [...(summary.topics ?? []), ...(summary.content_keywords ?? [])]) {
    const normalizedTopic = topic.trim();
    const identity = getTopicIdentity(normalizedTopic);
    const isNearDuplicate = Array.from(seenTopicIdentities).some(
      (savedIdentity) =>
        Math.abs(savedIdentity.length - identity.length) <= 3 &&
        (savedIdentity.includes(identity) || identity.includes(savedIdentity))
    );
    if (
      !normalizedTopic ||
      !identity ||
      seenTopicIdentities.has(identity) ||
      isNearDuplicate
    ) {
      continue;
    }

    seenTopicIdentities.add(identity);
    topicTags.push(normalizedTopic);
    if (topicTags.length === 6) {
      break;
    }
  }

  return topicTags;
}

function SummaryEmptyState({
  canSummarize,
  isSummarizing,
  onSummarize
}: SummaryEmptyStateProps) {
  const description = isSummarizing
    ? "内容文本已就绪，正在生成结构化总结。"
    : "内容文本已就绪，可以生成结构化总结。";

  return (
    <section className="shadow-hard-md relative min-h-[300px] overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper)] px-6 py-8 sm:px-8 sm:py-10">
      <div className="relative flex min-h-[220px] flex-col justify-between">
        <div>
          <span className="shadow-hard-sm inline-flex min-h-8 items-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--paper-raised)]">
            内容已提取
          </span>
          <h3 className="font-editorial mt-8 text-balance text-3xl font-bold tracking-normal text-[var(--ink)] sm:text-4xl">
            {isSummarizing ? "正在生成总结" : "未生成总结"}
          </h3>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            {description}
          </p>
        </div>

        {canSummarize ? (
          <button
            className="ink-block mt-8 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-[2px] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-65"
            disabled={isSummarizing}
            type="button"
            onClick={onSummarize}
          >
            {isSummarizing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            {isSummarizing ? "生成中" : "生成总结"}
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
  summaryGenerationMeta,
  transcribeErrorMessage,
  textSourceType,
  onSummarize,
  onTranscribe
}: SummaryTabProps) {
  const isShownotes = textSourceType === "shownotes";
  const isPodcast = mediaType === "podcast";
  const needsTranscription = !hasTranscript || (isPodcast && isShownotes);

  if (summaryDisplayState === "empty") {
    if (needsTranscription) {
      return (
        <div className="space-y-4">
          <TranscribeRequiredState
            canTranscribe={canTranscribe}
            description={
              isPodcast && isShownotes
                ? "当前只有节目页 shownotes，需要先生成完整转写稿，再整理总结。"
                : "需要先生成转写稿，再整理总结。"
            }
            isTranscribing={isTranscribing}
            title={isPodcast && isShownotes ? "未生成对话稿总结" : "未生成总结"}
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

    return (
      <div className="space-y-4">
        <SummaryEmptyState
          canSummarize={canSummarize}
          isSummarizing={isSummarizing}
          onSummarize={onSummarize}
        />

        {summaryErrorMessage ? (
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
            {summaryErrorMessage}
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

  const topicTags = getTopicTags(summary);
  const keyPointsTitle = summary.key_points_title?.trim() || "内容要点";
  const contentOutline = summary.content_outline ?? [];
  const methods = summary.methods ?? [];
  const deepDiveSections =
    summary.deep_dive_sections?.length
      ? summary.deep_dive_sections
      : summary.structured_analysis_markdown.trim()
        ? [
            {
              title: "结构化分析",
              markdown: summary.structured_analysis_markdown
            }
          ]
        : [];

  return (
    <div className="space-y-5">
      <section className="border-b-2 border-[var(--line-ink)] pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="font-editorial text-lg font-semibold text-[var(--ink)]">内容总结</h3>
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

      <section aria-label="一句话概览" className="space-y-4 px-1 py-2">
        <span
          aria-hidden="true"
          className="block h-1 w-7 bg-[var(--accent)]"
          data-summary-accent="true"
        />
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
        <SummarySectionHeading title={keyPointsTitle} />
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

      {contentOutline.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-[var(--ink)]">内容脉络</h3>
          <div className="mt-3 border-y border-[var(--line-strong)]">
            {contentOutline.map((item, index) => (
              <div
                className="grid grid-cols-[76px_1fr] border-b border-[var(--line)] last:border-b-0 even:bg-[var(--paper-deep)]/35"
                key={item}
              >
                <div className="mono px-3 py-3 text-xs text-[var(--muted)]">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="border-l border-[var(--line)] px-3 py-3 text-sm leading-6 text-[var(--ink-soft)]">
                  {item}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {methods.length > 0 ? (
      <section className="grid gap-5 lg:grid-cols-[140px_1fr] lg:gap-8">
        <SummarySectionHeading title={summary.method_title || "可借鉴的方法"} />
        <ol className="grid border-t border-[var(--line-strong)] sm:grid-cols-2">
          {methods.map((item, index) => (
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
      ) : null}

      {deepDiveSections.map((section) => (
        <section
          className="grid gap-5 border-y border-[var(--line-strong)] py-6 lg:grid-cols-[140px_1fr] lg:gap-8"
          key={`${section.title}-${section.markdown}`}
        >
          <SummarySectionHeading title={section.title} />
          <SafeMarkdown markdown={section.markdown} />
        </section>
      ))}

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
