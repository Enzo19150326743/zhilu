import assert from "node:assert/strict";
import test from "node:test";
import {
  getRecentCorrectionTerms,
  mergeCorrectionTerms,
  parseCorrectionTermInput
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

test("最近术语只保留使用过的记录并按时间排序", () => {
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
    },
    {
      id: 3,
      text: "未使用",
      usage_count: 0,
      last_used_at: null,
      created_at: "",
      updated_at: ""
    }
  ];
  assert.deepEqual(
    getRecentCorrectionTerms(terms).map((term) => term.text),
    ["Codex", "Cursor"]
  );
});
