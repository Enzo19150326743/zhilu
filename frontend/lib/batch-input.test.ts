import assert from "node:assert/strict";
import test from "node:test";
import { parseBatchInput } from "./batch-input";

test("extracts multiple urls and reports duplicates and invalid lines", () => {
  const result = parseBatchInput(`分享 https://example.com/a 和 https://example.com/b\nhttps://example.com/a\n不是链接`);
  assert.deepEqual(result.urls, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.invalidLines, ["不是链接"]);
});

test("marks 50 unique urls as over limit", () => {
  const result = parseBatchInput(Array.from({ length: 50 }, (_, index) => `https://e.test/${index}`).join("\n"));
  assert.equal(result.isTooMany, true);
});

test("多条链接无需逐条换行，支持分隔与分享文案自动去重", () => {
  for (const separator of ["\n", " ", "\t", "，", ";", "；", "、"]) {
    const result = parseBatchInput(
      `分享 https://example.com/a${separator}https://example.com/b 再分享 https://example.com/a`
    );
    assert.deepEqual(result.urls, ["https://example.com/a", "https://example.com/b"]);
    assert.equal(result.duplicateCount, 1);
    assert.deepEqual(result.invalidLines, []);
  }
});
