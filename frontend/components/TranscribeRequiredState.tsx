import { FileAudio, Loader2 } from "lucide-react";

interface TranscribeRequiredStateProps {
  canTranscribe: boolean;
  description: string;
  isTranscribing: boolean;
  title: string;
  onTranscribe: () => void;
}

export function TranscribeRequiredState({
  canTranscribe,
  description,
  isTranscribing,
  title,
  onTranscribe
}: TranscribeRequiredStateProps) {
  const canShowAction = canTranscribe || isTranscribing;

  return (
    <section
      className="shadow-hard-md relative min-h-[300px] overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper)] px-6 py-8 sm:px-8 sm:py-10"
      data-testid="transcribe-required-state"
    >
      <div className="relative flex min-h-[220px] flex-col justify-between">
        <div>
          <span className="shadow-hard-sm inline-flex min-h-8 items-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--paper-raised)]">
            需要内容文本
          </span>
          <h3 className="font-editorial mt-8 text-balance text-3xl font-bold tracking-normal text-[var(--ink)] sm:text-4xl">
            {title}
          </h3>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            {description}
          </p>
        </div>

        {canShowAction ? (
          <button
            className="ink-block mt-8 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-[2px] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-65"
            disabled={isTranscribing || !canTranscribe}
            type="button"
            onClick={onTranscribe}
          >
            {isTranscribing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileAudio className="h-4 w-4" aria-hidden="true" />
            )}
            {isTranscribing ? "生成中" : "生成转写稿"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
