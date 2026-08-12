import assert from "node:assert/strict";
import test from "node:test";
import {
  LIBRARY_PROCESSING_TIMEOUT_MS,
  normalizeLibraryProcessingWorkflows
} from "./library-processing";

test("处理标记只保留字段完整且未超过恢复时限的记录", () => {
  const now = 2_000_000;

  assert.deepEqual(
    normalizeLibraryProcessingWorkflows(
      [
        {
          sourceUrl: "https://example.com/active",
          startedAt: now - 1_000,
          videoId: "active"
        },
        {
          sourceUrl: "https://example.com/expired",
          startedAt: now - LIBRARY_PROCESSING_TIMEOUT_MS,
          videoId: "expired"
        },
        { sourceUrl: "", startedAt: now, videoId: "invalid" },
        null
      ],
      now
    ),
    [
      {
        sourceUrl: "https://example.com/active",
        startedAt: now - 1_000,
        videoId: "active"
      }
    ]
  );
});

test("同一档案的重复处理标记只保留最新一条", () => {
  const now = 2_000_000;

  assert.deepEqual(
    normalizeLibraryProcessingWorkflows(
      [
        {
          sourceUrl: "https://example.com/old",
          startedAt: now - 2_000,
          videoId: "same-video"
        },
        {
          sourceUrl: "https://example.com/new",
          startedAt: now - 1_000,
          videoId: "same-video"
        }
      ],
      now
    ),
    [
      {
        sourceUrl: "https://example.com/new",
        startedAt: now - 1_000,
        videoId: "same-video"
      }
    ]
  );
});
