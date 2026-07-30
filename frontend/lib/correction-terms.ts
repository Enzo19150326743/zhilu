import type { CorrectionTermItem } from "./types";

export const MAX_SELECTED_CORRECTION_TERMS = 120;

export function normalizeCorrectionTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseCorrectionTermInput(value: string): string[] {
  return dedupeCorrectionTerms(
    value
      .split(/[，,、；;\r\n]+/)
      .map(normalizeCorrectionTerm)
      .filter(Boolean)
  );
}

export function dedupeCorrectionTerms(terms: string[]): string[] {
  const seenTerms = new Set<string>();
  const result: string[] = [];
  for (const rawTerm of terms) {
    const term = normalizeCorrectionTerm(rawTerm);
    const normalizedKey = term.toLocaleLowerCase();
    if (!term || seenTerms.has(normalizedKey)) {
      continue;
    }
    seenTerms.add(normalizedKey);
    result.push(term);
  }
  return result;
}

export function mergeCorrectionTerms(
  currentTerms: string[],
  addedTerms: string[]
): string[] {
  return dedupeCorrectionTerms([...currentTerms, ...addedTerms]).slice(
    0,
    MAX_SELECTED_CORRECTION_TERMS
  );
}

export function removeCorrectionTerm(
  currentTerms: string[],
  removedTerm: string
): string[] {
  const removedKey = normalizeCorrectionTerm(removedTerm).toLocaleLowerCase();
  return currentTerms.filter(
    (term) => normalizeCorrectionTerm(term).toLocaleLowerCase() !== removedKey
  );
}

export function isCorrectionTermSelected(
  selectedTerms: string[],
  term: string
): boolean {
  const termKey = normalizeCorrectionTerm(term).toLocaleLowerCase();
  return selectedTerms.some(
    (selectedTerm) =>
      normalizeCorrectionTerm(selectedTerm).toLocaleLowerCase() === termKey
  );
}

export function selectCorrectionTermRange(
  selectedTerms: string[],
  visibleTerms: string[],
  anchorTerm: string | null,
  clickedTerm: string,
  append: boolean
): string[] {
  const anchorIndex = anchorTerm
    ? visibleTerms.findIndex((term) => isSameTerm(term, anchorTerm))
    : -1;
  const clickedIndex = visibleTerms.findIndex((term) =>
    isSameTerm(term, clickedTerm)
  );
  if (anchorIndex < 0 || clickedIndex < 0) {
    return append
      ? mergeCorrectionTerms(selectedTerms, [clickedTerm])
      : [clickedTerm];
  }

  const startIndex = Math.min(anchorIndex, clickedIndex);
  const endIndex = Math.max(anchorIndex, clickedIndex);
  const rangeTerms = visibleTerms.slice(startIndex, endIndex + 1);
  return append
    ? mergeCorrectionTerms(selectedTerms, rangeTerms)
    : dedupeCorrectionTerms(rangeTerms).slice(0, MAX_SELECTED_CORRECTION_TERMS);
}

export function invertCorrectionTermSelection(
  selectedTerms: string[],
  visibleTerms: string[]
): string[] {
  const outsideVisible = selectedTerms.filter(
    (selectedTerm) =>
      !visibleTerms.some((visibleTerm) => isSameTerm(visibleTerm, selectedTerm))
  );
  const invertedVisible = visibleTerms.filter(
    (visibleTerm) => !isCorrectionTermSelected(selectedTerms, visibleTerm)
  );
  return mergeCorrectionTerms(outsideVisible, invertedVisible);
}

export function getRecentCorrectionTerms(
  terms: CorrectionTermItem[],
  limit = 8
): CorrectionTermItem[] {
  return terms
    .filter((term) => Boolean(term.last_used_at))
    .sort((left, right) =>
      String(right.last_used_at).localeCompare(String(left.last_used_at))
    )
    .slice(0, limit);
}

export function getFrequentCorrectionTerms(
  terms: CorrectionTermItem[]
): CorrectionTermItem[] {
  return terms
    .filter((term) => term.usage_count > 0)
    .sort(
      (left, right) =>
        right.usage_count - left.usage_count ||
        String(right.last_used_at).localeCompare(String(left.last_used_at))
    );
}

function isSameTerm(left: string, right: string): boolean {
  return (
    normalizeCorrectionTerm(left).toLocaleLowerCase() ===
    normalizeCorrectionTerm(right).toLocaleLowerCase()
  );
}
