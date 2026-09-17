"use client";

import { ArrowLeft, Plus, RotateCcw, Square, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { ProcessingTaskItem, TaskBatchResponse, TaskBatchSummary } from "@/lib/types";

interface BatchWorkspaceProps {
  batch: TaskBatchResponse;
  busyTaskIds: ReadonlySet<string>;
  errorMessage: string | null;
  recentBatches: TaskBatchSummary[];
  onAdd: () => void;
  onBack: () => void;
  onCancel: (taskId: string) => void;
  onOpenBatch: (batchId: string) => void;
  onOpenResult: (videoId: string) => void;
  onRetry: (taskId: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  parse: "提取中",
  download: "下载转写素材",
  recognize: "转写中",
  correct: "校对中",
  summarize: "总结中",
  done: "已结束"
};

function taskLabel(item: ProcessingTaskItem): string {
  if (item.cancelled || item.status === "cancelled") return "已取消";
  if (item.status === "failed") return "失败";
  if (item.status === "succeeded") return item.warning ? "已完成（有提示）" : "已完成";
  if (item.status === "waiting_retry") return "等待额度恢复";
  if (item.status === "queued") return item.stage === "recognize" ? "等待转写" : "等待处理";
  return STAGE_LABELS[item.stage] ?? "处理中";
}

function visibleUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 72);
  } catch {
    return url.slice(0, 72);
  }
}

export function BatchWorkspace({ batch, busyTaskIds, errorMessage, recentBatches, onAdd, onBack, onCancel, onOpenBatch, onOpenResult, onRetry }: BatchWorkspaceProps) {
  const [filter, setFilter] = useState<"all" | "pending" | "failed">("all");
  const visibleItems = batch.items.filter((item) => {
    if (filter === "failed") return item.status === "failed";
    if (filter === "pending") return ["queued", "running", "waiting_retry"].includes(item.status);
    return true;
  });
  return (
    <section className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[var(--line-ink)] pb-5">
        <div>
          <button className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />返回首页
          </button>
          <h1 className="font-editorial text-3xl font-bold">批量任务</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            共 {batch.stats.total} 条 · 处理中 {batch.stats.active} · 完成 {batch.stats.succeeded} · 失败 {batch.stats.failed} · 取消 {batch.stats.cancelled}
          </p>
        </div>
        <button className="inline-flex h-10 items-center gap-2 border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] px-4 text-sm font-bold shadow-[2px_2px_0_0_var(--ink)]" type="button" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />添加链接
        </button>
      </div>

      {errorMessage ? <p className="mt-4 border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">{errorMessage}</p> : null}

      {recentBatches.length > 1 ? (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="最近批次">
          {recentBatches.map((entry) => (
            <button key={entry.batch_id} className={`border px-3 py-1.5 text-xs ${entry.batch_id === batch.batch_id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-ink)] bg-[var(--paper-raised)]"}`} type="button" onClick={() => onOpenBatch(entry.batch_id)}>
              {new Date(entry.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {entry.stats.total} 条
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex gap-2" aria-label="任务筛选">
        {([['all', `全部 ${batch.stats.total}`], ['pending', `未完成 ${batch.stats.active}`], ['failed', `失败 ${batch.stats.failed}`]] as const).map(([key, label]) => (
          <button key={key} className={`border-2 px-3 py-1.5 text-xs font-semibold ${filter === key ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-ink)] bg-[var(--paper-raised)]"}`} type="button" onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>

      <div className="mt-6 divide-y-2 divide-[var(--line-ink)] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] shadow-hard-md">
        {visibleItems.map((item) => (
          <article className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-center" key={item.task_id}>
            <div className="min-w-0">
              <p className="truncate font-semibold text-[var(--ink)]">{item.title || `第 ${item.input_index + 1} 条 · ${visibleUrl(item.source_url)}`}</p>
              <p className="mt-1 truncate text-xs text-[var(--muted)]">{item.author ? `${item.author} · ` : ""}{item.platform || visibleUrl(item.source_url)}</p>
              {item.error_message ? <details className="mt-2 text-xs text-[var(--accent-deep)]"><summary className="cursor-pointer">查看失败原因</summary><p className="mt-1 leading-5">{item.error_message}</p></details> : null}
              {item.warning ? <p className="mt-2 text-xs text-[#7a4a1f]">{item.warning}</p> : null}
            </div>
            <p className="text-sm font-semibold">{taskLabel(item)}</p>
            <div className="flex justify-start gap-2 sm:justify-end">
              {item.result_available && item.video_id ? (
                <button className="inline-flex h-9 items-center gap-1 border-2 border-[var(--line-ink)] px-3 text-xs font-semibold" type="button" onClick={() => onOpenResult(item.video_id!)}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />查看
                </button>
              ) : null}
              {item.status === "failed" || item.status === "cancelled" ? (
                <button aria-label="重试任务" className="inline-flex h-9 w-9 items-center justify-center border-2 border-[var(--line-ink)] disabled:opacity-50" disabled={busyTaskIds.has(item.task_id)} type="button" onClick={() => onRetry(item.task_id)}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
              ) : item.status === "queued" || item.status === "running" || item.status === "waiting_retry" ? (
                <button aria-label="取消任务" className="inline-flex h-9 w-9 items-center justify-center border-2 border-[var(--line-ink)] disabled:opacity-50" disabled={busyTaskIds.has(item.task_id)} type="button" onClick={() => onCancel(item.task_id)}><Square className="h-3.5 w-3.5" aria-hidden="true" /></button>
              ) : null}
            </div>
          </article>
        ))}
        {visibleItems.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">当前筛选没有任务。</p> : null}
      </div>
    </section>
  );
}
