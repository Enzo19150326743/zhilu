"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
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
  disabled?: boolean;
  selectedTerms: string[];
  onChange: (terms: string[]) => void;
}

export function CorrectionTermSelector({
  correctionAvailable,
  disabled = false,
  selectedTerms,
  onChange
}: CorrectionTermSelectorProps) {
  const [library, setLibrary] = useState<CorrectionTermLibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
  const availableRecentTerms = useMemo(
    () =>
      recentTerms.filter(
        (term) => !isCorrectionTermSelected(selectedTerms, term.text)
      ),
    [recentTerms, selectedTerms]
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[var(--ink-soft)]">本期术语</p>
        {selectedTerms.length > 0 ? (
          <span className="shrink-0 rounded-[2px] bg-[var(--paper-raised)] px-2 py-1 text-[11px] font-semibold text-[var(--accent)] ring-1 ring-[var(--line-strong)]">
            已选 {selectedTerms.length}
          </span>
        ) : null}
      </div>

      {!correctionAvailable ? (
        <div className="flex gap-2 rounded-[2px] border border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-xs leading-5 text-[#7a4a1f]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          AI 校对当前未启用，所选术语不会应用。
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          className="h-10 min-w-0 flex-1 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
          disabled={disabled}
          maxLength={2000}
          placeholder="输入易错的人名、品牌或英文术语，帮助校正转写"
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
          加入
        </button>
      </div>

      {selectedTerms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-[var(--muted)]">
            本期已选
          </span>
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
      ) : null}

      {isLoading ? (
        <div
          aria-label="正在加载最近使用的术语"
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"
          role="status"
        >
          <Loader2 className="h-3 w-3 animate-spin" /> 最近使用
        </div>
      ) : libraryError ? (
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span>最近使用加载失败</span>
          <button
            aria-label="重新加载最近使用的术语"
            className="inline-flex h-6 w-6 items-center justify-center rounded-[2px] border border-[var(--line-strong)] text-[var(--muted-strong)] hover:text-[var(--accent)]"
            type="button"
            onClick={() => void loadLibrary()}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      ) : availableRecentTerms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
            <Clock3 className="h-3 w-3" /> 最近
          </span>
          {availableRecentTerms.map((term) => (
            <button
              className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              disabled={disabled}
              key={term.id}
              type="button"
              onClick={() => toggleTerm(term.text)}
            >
              {term.text}
            </button>
          ))}
        </div>
      ) : null}

      {feedback ? <p className="text-xs leading-5 text-[#7a4a1f]">{feedback}</p> : null}
    </section>
  );
}
