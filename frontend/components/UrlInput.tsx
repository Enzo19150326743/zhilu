import { FileDown, Link2, Loader2, RotateCcw } from "lucide-react";
import { ActionMenu } from "./ActionMenu";

interface UrlInputProps {
  isParsing: boolean;
  value: string;
  errorMessage: string | null;
  onAnalyze: (forceRefresh?: boolean) => void;
  onChange: (value: string) => void;
}

export function UrlInput({
  isParsing,
  value,
  errorMessage,
  onAnalyze,
  onChange
}: UrlInputProps) {
  return (
    <section className="border-b-2 border-[var(--line-ink)] bg-[var(--paper)]">
      <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
          <span className="mono shrink-0 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
            SOURCE
          </span>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">公开媒体链接</span>
            <Link2
              className="pointer-events-none absolute left-0 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--muted)]"
              aria-hidden="true"
            />
            <input
              className="font-editorial h-12 w-full border-0 bg-transparent pl-7 pr-2 text-base text-[var(--ink)] outline-none placeholder:text-[#a39a87] disabled:cursor-not-allowed disabled:text-[var(--muted)]"
              inputMode="url"
              type="url"
              value={value}
              placeholder="粘贴公开媒体链接，例如 B 站 / 小宇宙 / 抖音…"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onAnalyze(false);
                }
              }}
            />
          </label>

          <div className="flex shrink-0 gap-3">
            <button
              className="shadow-hard-accent inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper-raised)] transition-[box-shadow,transform] duration-150 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_0_var(--accent)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 lg:flex-none"
              disabled={isParsing || !value.trim()}
              type="button"
              onClick={() => onAnalyze(false)}
            >
              {isParsing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileDown className="h-4 w-4" aria-hidden="true" />
              )}
              {isParsing ? "提取中" : "提取内容"}
            </button>
            <ActionMenu
              disabled={isParsing || !value.trim()}
              items={[
                {
                  icon: RotateCcw,
                  label: "重新提取源内容",
                  onSelect: () => onAnalyze(true)
                }
              ]}
              label="源内容操作"
            />
          </div>
        </div>

        {errorMessage ? (
          <div className="shadow-hard-sm mt-4 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
