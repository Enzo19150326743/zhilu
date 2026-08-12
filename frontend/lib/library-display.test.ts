import assert from "node:assert/strict";
import test from "node:test";
import {
  getFeaturedLibraryItems,
  getLibraryDisplayTitle,
  getLibraryStatusLabel,
  isLibraryItemSummarized,
  matchesLibraryFilter
} from "./library-display";
import { getPlatformLabel } from "./platform-display";
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
    "已总结"
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
    "需转写"
  );
});

test("档案处理状态优先于尚未同步的持久化结果", () => {
  assert.equal(
    getLibraryStatusLabel(
      createLibraryItem({ has_transcript: false }),
      true
    ),
    "处理中"
  );
  assert.equal(
    getLibraryStatusLabel(
      createLibraryItem({ summary_status: "ai_generated" }),
      true
    ),
    "处理中"
  );
});

test("档案标题去掉正文式话题并优先保留第一句", () => {
  assert.equal(
    getLibraryDisplayTitle(
      "君子豹变：所有向外找原因的人，都在原地烂下去。 后续是很长的正文说明，需要留在详情里而不是档案列表中。 #个人成长 #观点"
    ),
    "君子豹变：所有向外找原因的人，都在原地烂下去。"
  );
  assert.equal(getLibraryDisplayTitle("  普通标题  "), "普通标题");
  assert.equal(getLibraryDisplayTitle("   "), "未命名内容");
});

test("无逐字稿的旧总结不会同时出现在已总结和需转写", () => {
  const staleSummaryItem = createLibraryItem({
    has_transcript: false,
    summary_status: "ai_generated"
  });

  assert.equal(isLibraryItemSummarized(staleSummaryItem), false);
  assert.equal(getLibraryStatusLabel(staleSummaryItem), "需转写");
  assert.equal(matchesLibraryFilter(staleSummaryItem, "summarized"), false);
  assert.equal(matchesLibraryFilter(staleSummaryItem, "noTranscript"), true);
});

test("shownotes 即使带旧总结也只归入需转写", () => {
  const shownotesItem = createLibraryItem({
    summary_status: "local_fallback",
    text_source_type: "shownotes"
  });

  assert.equal(isLibraryItemSummarized(shownotesItem), false);
  assert.equal(matchesLibraryFilter(shownotesItem, "summarized"), false);
  assert.equal(matchesLibraryFilter(shownotesItem, "noTranscript"), true);
});

test("平台名称使用面向用户的中文标签", () => {
  assert.equal(getPlatformLabel("bilibili"), "B 站");
  assert.equal(getPlatformLabel("xiaoyuzhou"), "小宇宙");
  assert.equal(getPlatformLabel("xiaohongshu"), "小红书");
  assert.equal(getPlatformLabel("douyin"), "抖音");
  assert.equal(getPlatformLabel("demo"), "推荐");
  assert.equal(getPlatformLabel("custom"), "custom");
});
