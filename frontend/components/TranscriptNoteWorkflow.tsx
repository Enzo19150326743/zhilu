"use client";

import {
  CheckCircle2,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  Quote,
  Trash2
} from "lucide-react";
import { useState } from "react";
import { IconActionButton } from "./IconActionButton";
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
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null);

  const finishEditingHighlight = (highlightId: string) => {
    onDraftTextBlur(highlightId);
    setEditingHighlightId(null);
  };

  return (
    <div className="space-y-4">
      <section className="border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-3 shadow-[3px_3px_0_0_var(--ink)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-editorial text-base font-bold text-[var(--ink)]">AI 摘录</h3>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              从总结中挑出的原文句子。
            </p>
          </div>
          <span className="text-xs font-semibold tabular-nums text-[var(--accent)]">
            {candidateHighlights.length} 条
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
                  className="border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3"
                  key={`${highlight.id}-${highlight.text}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                    <span>{getHighlightSourceLabel(highlight)}</span>
                    <IconActionButton
                      disabled={isSavingDraft || isSaved}
                      icon={isSaved ? CheckCircle2 : Plus}
                      label={isSaved ? "已加入摘录草稿" : "加入摘录草稿"}
                      tone={isSaved ? "accent" : "default"}
                      onClick={() => onAddCandidate(highlight)}
                    />
                  </div>
                  <p className="font-editorial text-sm leading-6 text-[var(--ink-soft)]">
                    {highlight.text}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3 text-xs leading-5 text-[var(--muted)]">
            生成总结后，这里会显示候选摘录。
          </div>
        )}
      </section>

      <section className="border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-3 shadow-[3px_3px_0_0_var(--accent)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-editorial text-base font-bold text-[var(--ink)]">摘录草稿</h3>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              框选左侧原文即可加入，当前 {draftHighlights.length} 条。
            </p>
          </div>
          <IconActionButton
            disabled={isExportingNote || !sourceUrl}
            icon={isExportingNote ? Loader2 : FileDown}
            isSpinning={isExportingNote}
            label={isExportingNote ? "正在导出知识草稿" : "导出知识草稿"}
            tone="accent"
            onClick={onExportNote}
          />
        </div>

        {draftMessage ? (
          <div className="mt-3 border-2 border-[var(--line-ink)] bg-[#e9f2ea] px-3 py-2 text-xs text-[#2f5d3a]">
            {draftMessage}
          </div>
        ) : null}
        {draftErrorMessage ? (
          <div className="mt-3 border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-xs text-[#7a4a1f]">
            {draftErrorMessage}
          </div>
        ) : null}

        {draftHighlights.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {draftHighlights.map((highlight) => {
              const isEditing = editingHighlightId === highlight.id;
              const editStatus = draftEditStatuses[highlight.id];
              const visibleText = draftEditValues[highlight.id] ?? highlight.text;

              return (
                <div
                  className="border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3"
                  key={highlight.id}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
                      <Quote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{getHighlightSourceLabel(highlight)}</span>
                      {editStatus === "saving" ? (
                        <span className="shrink-0 text-[var(--accent)]">保存中</span>
                      ) : null}
                      {editStatus === "saved" ? (
                        <span className="shrink-0 text-[#2f5d3a]">已保存</span>
                      ) : null}
                      {editStatus === "error" ? (
                        <span className="shrink-0 text-[#7a4a1f]">保存失败</span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <IconActionButton
                        disabled={isSavingDraft}
                        icon={Pencil}
                        label="编辑摘录"
                        pressed={isEditing}
                        onClick={() => setEditingHighlightId(highlight.id)}
                      />
                      <IconActionButton
                        disabled={isSavingDraft}
                        icon={Trash2}
                        label="移出摘录草稿"
                        tone="danger"
                        onClick={() => onRemoveHighlight(highlight.id)}
                      />
                    </div>
                  </div>

                  {isEditing ? (
                    <textarea
                      aria-label="编辑摘录文字"
                      autoFocus
                      className="block min-h-[72px] w-full resize-none overflow-hidden border-2 border-[var(--accent)] bg-[var(--paper-raised)] px-2 py-1.5 text-sm leading-6 text-[var(--ink-soft)] outline-none shadow-[2px_2px_0_0_var(--accent-soft)]"
                      ref={resizeDraftTextarea}
                      rows={2}
                      value={visibleText}
                      onBlur={() => finishEditingHighlight(highlight.id)}
                      onChange={(event) => {
                        resizeDraftTextarea(event.currentTarget);
                        onDraftTextChange(highlight.id, event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          finishEditingHighlight(highlight.id);
                        }
                      }}
                    />
                  ) : (
                    <p className="font-editorial text-sm leading-6 text-[var(--ink-soft)]">
                      {visibleText}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3 text-xs leading-5 text-[var(--muted)]">
            在左侧原文中框选文字，再点击浮动按钮加入摘录。
          </div>
        )}
      </section>
    </div>
  );
}
