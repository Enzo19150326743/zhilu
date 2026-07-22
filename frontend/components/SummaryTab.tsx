import { ArrowUpRight, FileAudio, Loader2, Sparkles } from "lucide-react";
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
            icon: Sparkles,
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
  const ActionIcon = action?.icon ?? Sparkles;

  return (
    <section className="relative min-h-[300px] overflow-hidden rounded-2xl bg-zinc-950 px-6 py-8 text-white shadow-[0_24px_70px_rgba(24,24,27,0.22)] sm:px-8 sm:py-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:44px_44px] opacity-35" />
      <div className="relative flex min-h-[220px] flex-col justify-between">
        <div>
          <span className="inline-flex min-h-8 items-center rounded-full border border-white/10 bg-white/10 px-3 text-xs font-medium text-zinc-300">
            {isShownotesSource ? "已读取 shownotes" : "内容已提取"}
          </span>
          <h3 className="mt-8 text-balance text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            {title}
          </h3>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-zinc-300 sm:text-base">
            {description}
          </p>
        </div>

        {action ? (
          <button
            className="mt-8 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-950 shadow-[0_14px_34px_rgba(0,0,0,0.25)] transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-white"
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
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {transcribeErrorMessage}
          </div>
        ) : null}

        {summaryErrorMessage ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {summaryErrorMessage}
          </div>
        ) : null}

        {summaryNotice ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {summaryNotice}
          </div>
        ) : null}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
        暂无总结内容。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 border-y border-[var(--line-strong)] py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--ink)]">结构化总结</h3>
          </div>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-[var(--muted)]">
            一份可以继续编辑、摘录和导出的媒体知识提纲。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span
            className={`inline-flex min-h-8 items-center gap-2 text-xs font-medium ${
              summaryGenerationMeta
                ? summaryGenerationMeta.isAiGenerated
                  ? "text-sky-700"
                  : "text-amber-800"
                : "text-[var(--muted)]"
            }`}
          >
            <span className="h-px w-5 bg-current opacity-50" aria-hidden="true" />
            {summaryDisplayState === "demo"
              ? "推荐摘要"
              : summaryGenerationMeta?.isAiGenerated
                ? "智能总结已生成"
                : "基础摘要已生成"}
          </span>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-sm font-semibold text-white transition-[background-color,scale] duration-150 hover:bg-[var(--accent)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
            disabled={!canSummarize || isSummarizing}
            type="button"
            onClick={onSummarize}
          >
            {isSummarizing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            {isSummarizing
              ? "生成中"
              : summaryDisplayState === "generated"
                ? "重新生成底稿"
                : "生成知识底稿"}
          </button>
        </div>
      </section>

      {!hasTranscript ? (
        <div className="border-l-2 border-amber-400 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900">
          <div>
            <p className="font-medium">当前没有可用于总结的内容文本。</p>
            <p className="mt-1 text-amber-800">
              可以先生成转写稿，再整理总结、摘录和导图。
            </p>
            {canTranscribe ? (
              <button
                className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
                disabled={isTranscribing}
                type="button"
                onClick={onTranscribe}
              >
                {isTranscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {isTranscribing ? "生成中" : "生成转写稿"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {transcribeErrorMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {transcribeErrorMessage}
        </div>
      ) : null}

      {isPodcast && isShownotes ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm leading-6 text-blue-900">
          <p>
            当前只有 shownotes 原文，不是完整音频对话稿；必须先生成转写稿，才能继续总结、摘录和导图。
          </p>
          {canTranscribe ? (
            <button
              className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
              disabled={isTranscribing}
              type="button"
              onClick={onTranscribe}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {isTranscribing ? "生成中" : "生成转写稿"}
            </button>
          ) : null}
        </div>
      ) : null}

      {summaryErrorMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {summaryErrorMessage}
        </div>
      ) : null}

      {summaryNotice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {summaryNotice}
        </div>
      ) : null}

      <section className="relative grid overflow-hidden bg-[var(--paper-deep)]/55 px-5 py-6 sm:grid-cols-[112px_1fr] sm:gap-6 sm:px-6 sm:py-7">
        <div className="mb-4 flex items-center justify-between sm:mb-0 sm:block">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            摘要
          </p>
          <span className="font-editorial mt-3 block text-3xl text-[var(--accent)]/45">
            01
          </span>
        </div>
        <p className="font-editorial text-pretty border-l-2 border-[var(--accent)] pl-5 text-lg font-semibold leading-8 text-[var(--ink)] sm:text-xl sm:leading-9">
          {summary.tldr}
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[140px_1fr] lg:gap-8">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent)]">
            02 / 观点
          </p>
          <h3 className="font-editorial mt-1 text-xl font-semibold text-[var(--ink)]">
            核心观点
          </h3>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            沿着编号快速浏览这份内容的论证骨架。
          </p>
        </div>
        <ol className="border-t border-[var(--line-strong)]">
          {summary.key_points.map((point, index) => (
            <li
              className="grid grid-cols-[46px_1fr] gap-3 border-b border-[var(--line)] py-4 sm:grid-cols-[58px_1fr] sm:py-5"
              key={point}
            >
              <span className="font-editorial tabular-nums text-xl text-[var(--accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-pretty text-sm leading-7 text-[var(--ink-soft)] sm:text-[15px]">
                {point}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {summary.timeline.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-zinc-950">
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
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent)]">
            03 / 行动
          </p>
          <h3 className="font-editorial mt-1 text-xl font-semibold text-[var(--ink)]">
            可行动建议
          </h3>
        </div>
        <ol className="grid border-t border-[var(--line-strong)] sm:grid-cols-2">
          {summary.takeaways.map((item, index) => (
            <li
              className="group grid min-h-24 grid-cols-[34px_1fr_auto] gap-3 border-b border-[var(--line)] py-4 sm:odd:pr-5 sm:even:border-l sm:even:pl-5"
              key={item}
            >
              <span className="font-editorial tabular-nums text-base text-[var(--accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-pretty text-sm leading-6 text-[var(--ink-soft)]">
                {item}
              </p>
              <ArrowUpRight
                className="mt-0.5 h-4 w-4 text-[var(--muted)] transition-[color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
                aria-hidden="true"
              />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
