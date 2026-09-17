import { Github, ListChecks } from "lucide-react";

interface HeaderProps {
  onHomeClick: () => void;
  activeTaskCount?: number;
  onTasksClick?: () => void;
}

const GITHUB_URL = "https://github.com/Enzo19150326743/zhilu";

export function Header({ activeTaskCount = 0, onHomeClick, onTasksClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-[var(--line-ink)] bg-[var(--paper)]">
      <div className="mx-auto flex h-[4.75rem] max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <button
          className="group -ml-2 flex min-h-12 min-w-0 items-center gap-3 rounded-2xl px-2 pr-3 text-left transition-[background-color] duration-150 hover:bg-[var(--paper-deep)]/60"
          type="button"
          onClick={onHomeClick}
          title="返回首页"
        >
          <div
            aria-hidden="true"
            className="h-11 w-11 shrink-0 rounded-2xl bg-zinc-950"
          />
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <p className="font-editorial truncate text-base font-semibold text-[var(--ink)]">
                知录
              </p>
              <p className="mono hidden truncate text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] sm:block">
                Local Markdown desk
              </p>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <button
            className="inline-flex h-9 items-center gap-2 border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] px-3 text-xs font-bold shadow-[2px_2px_0_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!onTasksClick}
            type="button"
            onClick={onTasksClick}
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            任务{activeTaskCount > 0 ? ` · ${activeTaskCount}` : ""}
          </button>
          <a
            aria-label="在 GitHub 查看知录"
            className="group relative inline-flex h-9 w-9 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] text-[var(--ink)] shadow-[2px_2px_0_0_var(--ink)] transition-[box-shadow,transform,background-color] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:bg-[var(--paper-deep)] hover:shadow-[1px_1px_0_0_var(--ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            <span
              className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-50 w-max border border-[var(--line-ink)] bg-[var(--ink)] px-2 py-1 text-[11px] text-[var(--paper-raised)] opacity-0 shadow-[2px_2px_0_0_var(--accent)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              role="tooltip"
            >
              在 GitHub 查看知录
            </span>
          </a>
        </div>
      </div>
    </header>
  );
}
