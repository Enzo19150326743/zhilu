import { Link2, Loader2 } from "lucide-react";

interface UrlInputProps {
  isParsing: boolean;
  value: string;
  errorMessage: string | null;
  onAnalyze: () => void;
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
    <section className="bg-[var(--paper)]">
      <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-10">
        <form
          className="shadow-hard-sm flex min-h-14 min-w-0 items-stretch border-2 border-[var(--line-ink)] bg-[var(--paper-raised)]"
          onSubmit={(event) => {
            event.preventDefault();
            onAnalyze();
          }}
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">公开媒体链接</span>
            <Link2
              className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--muted)]"
              aria-hidden="true"
            />
            <input
              className="focus-subtle h-full min-h-[54px] w-full border-0 bg-transparent pl-11 pr-4 text-base text-[var(--ink)] outline-none placeholder:text-[#8f8675] disabled:cursor-not-allowed disabled:text-[var(--muted)]"
              inputMode="url"
              type="text"
              value={value}
              placeholder="粘贴公开媒体链接，例如 B 站 / 小红书 / 小宇宙 / 抖音…"
              onChange={(event) => onChange(event.target.value)}
            />
          </label>

          <button
            className="inline-flex min-h-[54px] shrink-0 items-center justify-center gap-2 border-l-2 border-[var(--line-ink)] bg-[var(--accent)] px-6 text-sm font-semibold text-[var(--paper-raised)] transition-colors hover:bg-[var(--accent-deep)] active:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)] disabled:text-[var(--muted)]"
            disabled={isParsing || !value.trim()}
            type="submit"
          >
            {isParsing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {isParsing ? "提取中" : "提取内容"}
          </button>
        </form>

        {errorMessage ? (
          <div className="shadow-hard-sm mt-4 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
