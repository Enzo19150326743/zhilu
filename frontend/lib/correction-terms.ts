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
