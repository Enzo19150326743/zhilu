import { CheckCircle2, CircleAlert, HardDrive, Loader2, X } from "lucide-react";
import type { ParseTask, SummaryTask, TranscribeTask } from "@/lib/types";

type WorkbenchTask = ParseTask | SummaryTask | TranscribeTask;

interface TranscribeTaskToastsProps {
  activeSourceUrl?: string | null;
  tasks: WorkbenchTask[];
  onDismiss: (taskId: string) => void;
  onRetryLocally?: (taskId: string) => void;
}

function isSummaryTask(task: WorkbenchTask): task is SummaryTask {
  return "kind" in task && task.kind === "summary";
}

function isParseTask(task: WorkbenchTask): task is ParseTask {
  return "kind" in task && task.kind === "parse";
}

function isTranscribeTask(task: WorkbenchTask): task is TranscribeTask {
  return !("kind" in task);
}

function getTaskStatusLabel(task: WorkbenchTask): string {
  if (task.status === "success") {
    if (isParseTask(task)) {
      return "解析已完成";
    }
    return isSummaryTask(task) ? "总结已生成" : "转写稿已生成";
  }

  if (task.status === "error") {
    if (isParseTask(task)) {
      return "解析失败";
    }
    return isSummaryTask(task) ? "总结生成失败" : "转写稿生成失败";
  }

  if (isParseTask(task)) {
    return "正在提取内容";
  }

  return isSummaryTask(task) ? "正在生成总结" : "正在生成转写稿";
}

function getTaskIcon(task: WorkbenchTask) {
  if (task.status === "success") {
    return <CheckCircle2 className="h-4 w-4 text-[#2f5d3a]" aria-hidden="true" />;
  }

  if (task.status === "error") {
    return <CircleAlert className="h-4 w-4 text-[#7a4a1f]" aria-hidden="true" />;
  }

  return <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" aria-hidden="true" />;
}

export function TranscribeTaskToasts({
  activeSourceUrl,
  tasks,
  onDismiss,
  onRetryLocally
}: TranscribeTaskToastsProps) {
  const visibleTasks = tasks.slice(0, 4);

  if (visibleTasks.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),380px)] space-y-2">
      {visibleTasks.map((task) => (
        <section
          className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-3 shadow-lg"
          key={task.id}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{getTaskIcon(task)}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--ink)]">
                {getTaskStatusLabel(task)}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted-strong)]">
                {task.title}
              </p>
              {task.status === "running" ? (
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  可以继续解析或打开其他链接，当前任务会在后台继续处理。
                </p>
              ) : null}
              {task.status === "success" && task.message ? (
                <p className="mt-1 text-xs leading-5 text-[#2f5d3a]">
                  {task.message}
                </p>
              ) : null}
              {task.status === "error" && task.errorMessage ? (
                <p className="mt-1 text-xs leading-5 text-[#7a4a1f]">
                  {task.errorMessage}
                </p>
              ) : null}
              {task.status === "error" &&
              isTranscribeTask(task) &&
              task.asrEngine === "fun_asr_flash" &&
              task.sourceUrl === activeSourceUrl &&
              onRetryLocally ? (
                <button
                  className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[2px] bg-[var(--ink)] px-2.5 text-xs font-semibold text-[var(--paper)] transition hover:bg-[var(--accent-deep)]"
                  type="button"
                  onClick={() => onRetryLocally(task.id)}
                >
                  <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                  改用本地识别
                </button>
              ) : null}
            </div>
            <button
              aria-label="隐藏任务提示"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] text-[var(--muted)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
              title="仅隐藏提示，后台任务会继续处理"
              type="button"
              onClick={() => onDismiss(task.id)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
