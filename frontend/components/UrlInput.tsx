import { Link2, Loader2, Play } from "lucide-react";

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
    <section className="border-b border-[var(--line)] bg-[var(--paper-deep)]/65">
      <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-10">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            Source intake
          </span>
          <span className="h-px flex-1 bg-[var(--line-strong)]" />
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <label className="relative flex-1 rounded-[20px] bg-[var(--paper-raised)] p-2 shadow-[var(--shadow-paper)]">
            <span className="sr-only">公开媒体链接</span>
            <Link2
              className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
              aria-hidden="true"
            />
            <input
              className="h-12 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--paper)] pl-10 pr-4 text-sm text-[var(--ink)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--muted)] hover:border-[var(--ink-soft)] focus:border-[var(--accent)] focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:cursor-not-allowed disabled:text-[var(--muted)]"
              inputMode="url"
              type="url"
              value={value}
              placeholder="粘贴公开媒体链接，例如 B 站 / 小宇宙 / 抖音..."
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onAnalyze(false);
                }
              }}
            />
          </label>

          <div className="flex gap-2">
            <button
              className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-[16px] bg-[var(--ink)] pl-5 pr-[18px] text-sm font-semibold text-[var(--paper-raised)] transition-[background-color,scale] duration-150 hover:bg-[var(--accent)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)] lg:flex-none"
              disabled={isParsing || !value.trim()}
              type="button"
              onClick={() => onAnalyze(false)}
            >
              {isParsing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              {isParsing ? "提取中" : "生成底稿"}
            </button>
            <button
              className="inline-flex min-h-14 flex-1 items-center justify-center rounded-[16px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-4 text-sm font-semibold text-[var(--muted-strong)] transition-[background-color,border-color,color,scale] duration-150 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 lg:flex-none"
              disabled={isParsing || !value.trim()}
              title="绕过本地缓存，重新获取平台公开内容"
              type="button"
              onClick={() => onAnalyze(true)}
            >
              重新提取
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>默认优先读取本地历史；重新提取会再次请求平台公开内容。</p>
          <p className="text-[var(--accent)]">
            仅处理你有权访问和分析的公开内容，不支持付费、私密或受限内容。
          </p>
        </div>

        {errorMessage ? (
          <div className="mt-3 border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
