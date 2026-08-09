import { Github, Sparkles } from "lucide-react";

interface HeaderProps {
  onHomeClick: () => void;
}

const GITHUB_URL = "https://github.com/Enzo19150326743/zhilu";

export function Header({ onHomeClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-[var(--line-ink)] bg-[var(--paper)]">
      <div className="mx-auto flex h-[4.75rem] max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <button
          className="group -ml-2 flex min-h-12 min-w-0 items-center gap-3 rounded-2xl px-2 pr-3 text-left transition-[background-color] duration-150 hover:bg-[var(--paper-deep)]/60"
          type="button"
          onClick={onHomeClick}
          title="返回首页"
        >
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
          </div>
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

        <div className="flex items-center gap-5">
          <span className="mono hidden text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] md:block">
            VOL.01 — 本地 Markdown 知识工作台
          </span>
          <a
            className="ink-block mono inline-flex items-center gap-2 rounded-[2px] bg-[var(--paper-raised)] px-3.5 py-2 text-xs font-medium text-[var(--ink)]"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <Github className="h-3.5 w-3.5" aria-hidden="true" />
            Star on GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
