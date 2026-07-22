import assert from "node:assert/strict";
import test from "node:test";
import {
  getFeaturedLibraryItems,
  getLibraryStatusLabel,
  getPlatformLabel
} from "./library-display";
import type { LibraryItem } from "./types";

function createLibraryItem(
  overrides: Partial<LibraryItem> = {}
): LibraryItem {
  return {
    author: "演示作者",
    duration: 300,
    has_transcript: true,
    platform: "bilibili",
    source_url: "https://example.com/source",
    summary_model: null,
    summary_status: "none",
    thumbnail: "",
    title: "演示内容",
    updated_at: "2026-07-20T12:00:00+00:00",
    video_id: "demo-video",
    ...overrides
  };
}

test("首页档案按更新时间倒序选择最近三条", () => {
  const items = [
    createLibraryItem({ video_id: "old", updated_at: "2026-07-18T08:00:00Z" }),
    createLibraryItem({ video_id: "new", updated_at: "2026-07-21T08:00:00Z" }),
    createLibraryItem({ video_id: "middle", updated_at: "2026-07-20T08:00:00Z" }),
    createLibraryItem({ video_id: "older", updated_at: "2026-07-19T08:00:00Z" })
  ];

  assert.deepEqual(
    getFeaturedLibraryItems(items).map((item) => item.video_id),
    ["new", "middle", "older"]
  );
});

test("档案状态沿用 shownotes、总结和文本可用性语义", () => {
  assert.equal(
    getLibraryStatusLabel(
      createLibraryItem({ text_source_type: "shownotes" })
    ),
    "需转写"
  );
  assert.equal(
    getLibraryStatusLabel(
      createLibraryItem({ summary_status: "ai_generated" })
    ),
    "智能总结"
  );
  assert.equal(
    getLibraryStatusLabel(
      createLibraryItem({ summary_status: "local_fallback" })
    ),
    "基础摘要"
  );
  assert.equal(getLibraryStatusLabel(createLibraryItem()), "可总结");
  assert.equal(
    getLibraryStatusLabel(createLibraryItem({ has_transcript: false })),
    "无文本"
  );
});

test("平台名称使用面向用户的中文标签", () => {
  assert.equal(getPlatformLabel("bilibili"), "B 站");
  assert.equal(getPlatformLabel("xiaoyuzhou"), "小宇宙");
  assert.equal(getPlatformLabel("douyin"), "抖音");
  assert.equal(getPlatformLabel("demo"), "推荐");
  assert.equal(getPlatformLabel("custom"), "custom");
});
