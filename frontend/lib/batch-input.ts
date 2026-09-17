const URL_PATTERN = /https?:\/\/[^\s，。；;、]+/g;
export const MAX_BATCH_ITEMS = 49;
export const MAX_BATCH_INPUT_LENGTH = 64 * 1024;

export interface BatchInputResult {
  urls: string[];
  duplicateCount: number;
  invalidLines: string[];
  isTooLong: boolean;
  isTooMany: boolean;
}

export function parseBatchInput(value: string): BatchInputResult {
  const seen = new Set<string>();
  const urls: string[] = [];
  let duplicateCount = 0;
  const invalidLines: string[] = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const matches = line.match(URL_PATTERN) ?? [];
    if (matches.length === 0) {
      invalidLines.push(line);
      continue;
    }
    for (const match of matches) {
      const url = match.replace(/[).,，。；;、]+$/, "");
      if (seen.has(url)) {
        duplicateCount += 1;
      } else {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  return {
    urls,
    duplicateCount,
    invalidLines,
    isTooLong: value.length > MAX_BATCH_INPUT_LENGTH,
    isTooMany: urls.length > MAX_BATCH_ITEMS
  };
}
