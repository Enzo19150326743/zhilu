import { MediaUrlForm } from "./MediaUrlForm";

interface UrlInputProps {
  isSubmitting: boolean;
  value: string;
  errorMessage: string | null;
  onAnalyze: () => void;
  onBatchAdd?: () => void;
  onChange: (value: string) => void;
}

export function UrlInput({
  isSubmitting,
  value,
  errorMessage,
  onAnalyze,
  onBatchAdd,
  onChange
}: UrlInputProps) {
  return (
    <section className="bg-[var(--paper)]">
      <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-10">
        <MediaUrlForm
          isSubmitting={isSubmitting}
          value={value}
          onAnalyze={onAnalyze}
          onChange={onChange}
        />

        {onBatchAdd ? (
          <button
            className="mt-2 text-xs font-semibold text-[var(--muted)] underline decoration-2 underline-offset-4 hover:text-[var(--accent)]"
            type="button"
            onClick={onBatchAdd}
          >
            处理设置或批量添加
          </button>
        ) : null}

        {errorMessage ? (
          <div className="shadow-hard-sm mt-4 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
