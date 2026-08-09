import {
  formatElapsedSeconds,
  formatTimestamp,
  getTranscriptForViewMode,
  getTranscriptVariantLabel,
  type TranscriptViewMode
} from "@/lib/transcript-workbench";
import type { TranscriptPayload } from "@/lib/types";

interface TranscriptComparisonColumnProps {
  transcript: TranscriptPayload;
  variantKey: string;
  viewMode: TranscriptViewMode;
}

export function TranscriptComparisonColumn({
  transcript,
  variantKey,
  viewMode
}: TranscriptComparisonColumnProps) {
  const visibleTranscript = getTranscriptForViewMode(transcript, viewMode);
  const meta = transcript.asr_meta;

  return (
    <section className="min-w-0 overflow-hidden rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)]">
      <header className="border-b border-[var(--line-strong)] bg-[var(--paper)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--ink)]">
          {getTranscriptVariantLabel(variantKey)}
        </p>
        <p className="mt-1 break-all text-xs text-[var(--muted)]">
          {meta?.model ?? "未记录模型"} · {meta?.device ?? "未知设备"}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[var(--muted-strong)]">
          <span>识别 {formatElapsedSeconds(meta?.transcription_seconds)}</span>
          <span>校对 {formatElapsedSeconds(meta?.correction_seconds)}</span>
          <span>总计 {formatElapsedSeconds(meta?.total_seconds)}</span>
        </div>
      </header>
      <div className="max-h-[520px] overflow-auto">
        {visibleTranscript.segments.map((segment, index) => (
          <div
            className="grid gap-2 border-b border-[var(--line)] px-3 py-3 last:border-b-0 sm:grid-cols-[58px_minmax(0,1fr)]"
            key={`${variantKey}-${index}-${segment.start}-${segment.end}`}
          >
            <span className="mono text-[11px] text-[var(--muted)]">
              {formatTimestamp(segment.start)}
            </span>
            <p className="text-sm leading-6 text-[var(--ink-soft)]">{segment.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
