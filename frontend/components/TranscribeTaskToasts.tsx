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
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  }

  if (task.status === "error") {
    return <CircleAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />;
  }

  return <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />;
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
          className="rounded-lg border border-zinc-200 bg-white p-3 shadow-lg"
          key={task.id}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{getTaskIcon(task)}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-950">
                {getTaskStatusLabel(task)}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">
                {task.title}
              </p>
              {task.status === "running" ? (
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  可以继续解析或打开其他链接，当前任务会在后台继续处理。
                </p>
              ) : null}
              {task.status === "success" && task.message ? (
                <p className="mt-1 text-xs leading-5 text-emerald-700">
                  {task.message}
                </p>
              ) : null}
              {task.status === "error" && task.errorMessage ? (
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  {task.errorMessage}
                </p>
              ) : null}
              {task.status === "error" &&
              isTranscribeTask(task) &&
              task.asrEngine === "fun_asr_flash" &&
              task.sourceUrl === activeSourceUrl &&
              onRetryLocally ? (
                <button
                  className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-950 px-2.5 text-xs font-semibold text-white transition hover:bg-blue-600"
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
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-950"
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
