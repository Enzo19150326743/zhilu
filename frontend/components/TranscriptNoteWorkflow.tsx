import {
  CheckCircle2,
  FileDown,
  Loader2,
  Plus,
  Quote,
  Trash2
} from "lucide-react";
import {
  getHighlightIdentity,
  getHighlightSourceLabel,
  normalizeCandidateHighlight,
  type DraftEditStatus
} from "@/lib/transcript-workbench";
import type { SummaryHighlight } from "@/lib/types";

interface TranscriptNoteWorkflowProps {
  candidateHighlights: SummaryHighlight[];
  draftEditStatuses: Record<string, DraftEditStatus>;
  draftEditValues: Record<string, string>;
  draftErrorMessage: string | null;
  draftHighlights: SummaryHighlight[];
  draftMessage: string | null;
  isExportingNote: boolean;
  isSavingDraft: boolean;
  savedHighlightIdentities: Set<string>;
  sourceUrl?: string | null;
  textSourceType?: string | null;
  onAddCandidate: (highlight: SummaryHighlight) => void;
  onDraftTextBlur: (highlightId: string) => void;
  onDraftTextChange: (highlightId: string, text: string) => void;
  onExportNote: () => void;
  onRemoveHighlight: (highlightId: string) => void;
}

function resizeDraftTextarea(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export function TranscriptNoteWorkflow({
  candidateHighlights,
  draftEditStatuses,
  draftEditValues,
  draftErrorMessage,
  draftHighlights,
  draftMessage,
  isExportingNote,
  isSavingDraft,
  savedHighlightIdentities,
  sourceUrl,
  textSourceType,
  onAddCandidate,
  onDraftTextBlur,
  onDraftTextChange,
  onExportNote,
  onRemoveHighlight
}: TranscriptNoteWorkflowProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">AI 摘录</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              展示总结结果中值得保留的原文表达，可加入下方草稿后再导出为知识稿。
            </p>
          </div>
          <span className="inline-flex h-7 w-fit items-center rounded-[2px] bg-[var(--paper-deep)] px-2.5 text-xs font-medium text-[var(--muted-strong)]">
            {candidateHighlights.length} 条摘录
          </span>
        </div>
        {candidateHighlights.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {candidateHighlights.map((highlight) => {
              const normalizedHighlight = normalizeCandidateHighlight(
                highlight,
                textSourceType
              );
              const isSaved = savedHighlightIdentities.has(
                getHighlightIdentity(normalizedHighlight)
              );

              return (
                <div
                  className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3"
                  key={`${highlight.id}-${highlight.text}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                        <span>{getHighlightSourceLabel(highlight)}</span>
                      </div>
                      <p className="text-sm leading-6 text-[var(--ink-soft)]">
                        {highlight.text}
                      </p>
                      {highlight.reason ? (
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                          {highlight.reason}
                        </p>
                      ) : null}
                    </div>
                    <button
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 text-sm font-medium text-[var(--ink-soft)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingDraft || isSaved}
                      type="button"
                      onClick={() => onAddCandidate(highlight)}
                    >
                      {isSaved ? (
                        <CheckCircle2 className="h-4 w-4 text-[#2f5d3a]" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {isSaved ? "已加入" : "加入摘录"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-[2px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--muted)]">
            生成总结后，这里会显示可加入知识稿的摘录。
          </div>
        )}
      </section>

      <section className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">摘录草稿</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              框选下方原文，即可加入摘录；加入后可直接修改文字。已加入 {draftHighlights.length} 条。
            </p>
          </div>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
            disabled={isExportingNote || !sourceUrl}
            type="button"
            onClick={onExportNote}
          >
            {isExportingNote ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {isExportingNote ? "导出中" : "导出知识草稿"}
          </button>
        </div>

        {draftMessage ? (
          <div className="mt-3 rounded-[2px] border-2 border-[var(--line-ink)] bg-[#e9f2ea] px-3 py-2 text-sm text-[#2f5d3a]">
            {draftMessage}
          </div>
        ) : null}
        {draftErrorMessage ? (
          <div className="mt-3 rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
            {draftErrorMessage}
          </div>
        ) : null}

        {draftHighlights.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {draftHighlights.map((highlight) => (
              <div
                className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3"
                key={highlight.id}
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      <Quote className="h-3.5 w-3.5" />
                      <span>{getHighlightSourceLabel(highlight)}</span>
                      {draftEditStatuses[highlight.id] === "saving" ? (
                        <span className="text-[var(--accent)]">保存中</span>
                      ) : null}
                      {draftEditStatuses[highlight.id] === "saved" ? (
                        <span className="text-[#2f5d3a]">已保存</span>
                      ) : null}
                      {draftEditStatuses[highlight.id] === "error" ? (
                        <span className="text-[#7a4a1f]">保存失败</span>
                      ) : null}
                    </div>
                    <textarea
                      aria-label="编辑摘录文字"
                      className="block min-h-[64px] w-full resize-none overflow-hidden rounded-[2px] border border-transparent bg-transparent px-2 py-1 text-sm leading-6 text-[var(--ink-soft)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:bg-[var(--paper-raised)] focus:shadow-[0_0_0_3px_rgba(209,75,49,0.12)]"
                      ref={resizeDraftTextarea}
                      rows={1}
                      value={draftEditValues[highlight.id] ?? highlight.text}
                      onBlur={() => onDraftTextBlur(highlight.id)}
                      onChange={(event) => {
                        resizeDraftTextarea(event.currentTarget);
                        onDraftTextChange(highlight.id, event.currentTarget.value);
                      }}
                    />
                  </div>
                  <button
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 text-sm font-medium text-[var(--ink-soft)] transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSavingDraft}
                    type="button"
                    onClick={() => onRemoveHighlight(highlight.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    移出
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-[2px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--muted)]">
            在下方原文中拖拽框选文字，点击浮动按钮即可加入摘录。
          </div>
        )}
      </section>
    </div>
  );
}
