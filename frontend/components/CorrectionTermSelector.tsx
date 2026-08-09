"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Plus,
  Sparkles,
  X
} from "lucide-react";
import { CorrectionTermLibraryManager } from "./CorrectionTermLibraryManager";
import { apiClient } from "@/lib/api";
import {
  getRecentCorrectionTerms,
  isCorrectionTermSelected,
  MAX_SELECTED_CORRECTION_TERMS,
  mergeCorrectionTerms,
  parseCorrectionTermInput,
  removeCorrectionTerm
} from "@/lib/correction-terms";
import type { CorrectionTermLibraryResponse } from "@/lib/types";

interface CorrectionTermSelectorProps {
  correctionAvailable: boolean;
  correctionMessage?: string | null;
  disabled?: boolean;
  selectedTerms: string[];
  onChange: (terms: string[]) => void;
}

export function CorrectionTermSelector({
  correctionAvailable,
  correctionMessage,
  disabled = false,
  selectedTerms,
  onChange
}: CorrectionTermSelectorProps) {
  const [library, setLibrary] = useState<CorrectionTermLibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [quickInput, setQuickInput] = useState("");

  const loadLibrary = async () => {
    setIsLoading(true);
    setLibraryError(null);
    try {
      setLibrary(await apiClient.getCorrectionTermLibrary());
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "术语库加载失败，请稍后重试。"
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

  const recentTerms = useMemo(
    () => getRecentCorrectionTerms(library?.terms ?? []),
    [library]
  );
  const selectedPreview = selectedTerms.slice(0, 10);

  const addTermsToSelection = (rawValue: string) => {
    const parsedTerms = parseCorrectionTermInput(rawValue);
    if (parsedTerms.length === 0) {
      setFeedback("请输入至少一个有效术语。");
      return false;
    }
    if (parsedTerms.some((term) => term.length > 80)) {
      setFeedback("单个术语不能超过 80 个字符。");
      return false;
    }

    const nextTerms = mergeCorrectionTerms(selectedTerms, parsedTerms);
    onChange(nextTerms);
    setFeedback(
      nextTerms.length >= MAX_SELECTED_CORRECTION_TERMS &&
        nextTerms.length < selectedTerms.length + parsedTerms.length
        ? `本期最多选择 ${MAX_SELECTED_CORRECTION_TERMS} 个术语。`
        : null
    );
    return true;
  };

  const toggleTerm = (term: string) => {
    onChange(
      isCorrectionTermSelected(selectedTerms, term)
        ? removeCorrectionTerm(selectedTerms, term)
        : mergeCorrectionTerms(selectedTerms, [term])
    );
  };

  const handleQuickAdd = () => {
    if (addTermsToSelection(quickInput)) {
      setQuickInput("");
    }
  };

  return (
    <section className="space-y-3 rounded-[2px] border border-[var(--line-strong)] bg-[var(--accent-soft)]/45 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
            AI 校对术语
            <span className="font-normal text-[var(--muted)]">可选</span>
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            填写容易写错的专有名词，仅在语音识别完成后用于 AI 校对，不改变原始识别稿。
          </p>
        </div>
        <span className="shrink-0 rounded-[2px] bg-[var(--paper-raised)] px-2 py-1 text-[11px] font-semibold text-[var(--accent)] shadow-sm ring-1 ring-[var(--line-strong)]">
          已选 {selectedTerms.length}/{MAX_SELECTED_CORRECTION_TERMS}
        </span>
      </div>

      {!correctionAvailable ? (
        <div className="flex gap-2 rounded-[2px] border border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-xs leading-5 text-[#7a4a1f]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {correctionMessage || "AI 校对当前不可用，所选术语不会应用到终稿。"}
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          className="h-10 min-w-0 flex-1 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
          disabled={disabled}
          maxLength={2000}
          placeholder="输入人名、品牌或英文术语，支持逗号、顿号、换行"
          value={quickInput}
          onChange={(event) => setQuickInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              handleQuickAdd();
            }
          }}
        />
        <button
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[2px] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--paper)] transition hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !quickInput.trim()}
          type="button"
          onClick={handleQuickAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          加入本期
        </button>
      </div>

      {recentTerms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
            <Clock3 className="h-3 w-3" /> 最近
          </span>
          {recentTerms.map((term) => {
            const selected = isCorrectionTermSelected(selectedTerms, term.text);
            return (
              <button
                className={`rounded-[2px] border px-2.5 py-1 text-[11px] font-medium transition ${
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--paper)]"
                    : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--muted-strong)] hover:border-[var(--accent)]"
                }`}
                disabled={disabled}
                key={term.id}
                type="button"
                onClick={() => toggleTerm(term.text)}
              >
                {term.text}
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedTerms.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedPreview.map((term) => (
            <span
              className="inline-flex items-center gap-1 rounded-[2px] bg-[var(--paper-raised)] px-2 py-1 text-xs font-medium text-[var(--ink-soft)] ring-1 ring-[var(--line-strong)]"
              key={term}
            >
              {term}
              <button
                aria-label={`移除术语：${term}`}
                className="text-[var(--muted)] transition hover:text-red-600"
                disabled={disabled}
                type="button"
                onClick={() => onChange(removeCorrectionTerm(selectedTerms, term))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedTerms.length > selectedPreview.length ? (
            <span className="px-1 py-1 text-xs text-[var(--muted)]">
              另有 {selectedTerms.length - selectedPreview.length} 个
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">本期未选择术语，系统不会使用隐藏术语。</p>
      )}

      <button
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span>管理与选择术语库</span>
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {isExpanded ? (
        <div className="overflow-hidden rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] shadow-sm">
          <CorrectionTermLibraryManager
            isLoading={isLoading}
            library={library}
            libraryError={libraryError}
            selectedTerms={selectedTerms}
            onChange={onChange}
            onReload={loadLibrary}
          />
        </div>
      ) : null}

      {feedback ? <p className="text-xs leading-5 text-[#7a4a1f]">{feedback}</p> : null}
    </section>
  );
}
