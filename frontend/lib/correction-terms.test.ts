import assert from "node:assert/strict";
import test from "node:test";
import {
  getFrequentCorrectionTerms,
  invertCorrectionTermSelection,
  mergeCorrectionTerms,
  parseCorrectionTermInput,
  selectCorrectionTermRange
} from "./correction-terms";

test("批量输入支持常用分隔符并忽略大小写重复", () => {
  assert.deepEqual(
    parseCorrectionTermInput("DeepSeek、 Codex\nCursor，deepseek；OpenAI"),
    ["DeepSeek", "Codex", "Cursor", "OpenAI"]
  );
});

test("合并术语时保留已有写法并去重", () => {
  assert.deepEqual(
    mergeCorrectionTerms(["DeepSeek"], ["deepseek", "Cursor"]),
    ["DeepSeek", "Cursor"]
  );
});

test("Shift 连选和反选只作用于当前可见列表", () => {
  const visibleTerms = ["A", "B", "C", "D"];
  assert.deepEqual(
    selectCorrectionTermRange(["X"], visibleTerms, "B", "D", true),
    ["X", "B", "C", "D"]
  );
  assert.deepEqual(invertCorrectionTermSelection(["X", "B"], visibleTerms), [
    "X",
    "A",
    "C",
    "D"
  ]);
});

test("常用术语按使用次数排序", () => {
  const terms = [
    {
      id: 1,
      text: "Codex",
      usage_count: 2,
      last_used_at: "2026-07-28T00:00:00+00:00",
      created_at: "",
      updated_at: ""
    },
    {
      id: 2,
      text: "Cursor",
      usage_count: 5,
      last_used_at: "2026-07-27T00:00:00+00:00",
      created_at: "",
      updated_at: ""
    }
  ];
  assert.deepEqual(
    getFrequentCorrectionTerms(terms).map((term) => term.text),
    ["Cursor", "Codex"]
  );
});
