import { Sparkles } from "lucide-react";

interface HeaderProps {
  onHomeClick: () => void;
}

export function Header({ onHomeClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[rgba(244,240,231,0.88)] backdrop-blur-2xl">
      <div className="mx-auto flex h-[4.5rem] max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <button
          className="group -ml-2 flex min-h-12 min-w-0 items-center gap-3 rounded-2xl px-2 pr-3 text-left transition-[background-color,scale] duration-200 hover:bg-white/60 active:scale-[0.96]"
          type="button"
          onClick={onHomeClick}
          title="返回首页"
        >
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-[0_18px_40px_rgba(24,24,27,0.18)]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <p className="font-editorial truncate text-base font-semibold text-[var(--ink)]">
                知录
              </p>
              <p className="hidden truncate text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] sm:block">
                Local Markdown desk
              </p>
            </div>
          </div>
        </button>

        <div className="hidden items-center gap-5 text-xs text-[var(--muted)] sm:flex">
          <span>本地 Markdown</span>
          <span className="h-3 w-px bg-[var(--line-strong)]" aria-hidden="true" />
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            开源版本
          </span>
        </div>
      </div>
    </header>
  );
}
