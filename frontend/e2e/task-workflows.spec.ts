import { expect, test } from "@playwright/test";
import {
  summarizedItem,
  needsTranscriptItem,
  emptySummary,
  generatedTranscript,
  transcribedNeedsTranscriptDetail,
  processedNeedsTranscriptItem,
  json,
  installApiMocks,
  watchBrowserErrors,
} from "./support";
import { LIBRARY_PROCESSING_STORAGE_KEY } from "../lib/library-processing";

test("批量添加首屏只提供链接和处理设置", async ({ page }, testInfo) => {
  const browserErrors = watchBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "处理设置或批量添加", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "批量添加" });
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(dialog.getByText("处理设置（可选）", { exact: true })).toBeVisible();
  const layout = await dialog.evaluate((element) => {
    const body = element.querySelector<HTMLElement>(":scope > div:nth-last-child(2)")!;
    const box = element.getBoundingClientRect();
    return { bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight, width: box.width, top: box.top, bottom: box.bottom };
  });
  expect(layout.width).toBeLessThanOrEqual(672);
  expect(layout.top).toBeGreaterThanOrEqual(24);
  expect(layout.bottom).toBeLessThanOrEqual(696);
  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.bodyHeight + 1);
  await dialog.screenshot({ path: testInfo.outputPath("batch-dialog.png") });
  const batchInput = dialog.getByLabel("视频链接");
  await batchInput.focus();
  await expect(batchInput).toHaveCSS("border-top-color", "rgb(209, 75, 49)");
  await expect(batchInput).toHaveCSS("outline-style", "none");
  await batchInput.blur();
  await expect(batchInput).toHaveCSS("border-top-color", "rgb(33, 29, 23)");

  await expect(dialog.getByText("不必每条换行；用换行、空格或分号隔开，系统会自动提取链接并去重。", { exact: true })).toBeVisible();
  await dialog.getByLabel("视频链接").fill("分享 https://example.com/a https://example.com/b;https://example.com/a");
  await expect(dialog.getByText("有效 2 条", { exact: true })).toBeVisible();
  await expect(dialog.getByText("重复 1 条（已折叠）", { exact: true })).toBeVisible();
  await dialog.getByText("处理设置（可选）", { exact: true }).click();
  await expect(dialog.getByRole("button", { name: "自动判断", exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "开始处理 2 条" })).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByText("处理设置（可选）", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 700 });
  const narrowLayout = await dialog.evaluate((element) => {
    const body = element.querySelector<HTMLElement>(":scope > div:nth-last-child(2)")!;
    const box = element.getBoundingClientRect();
    return { bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight, left: box.left, right: box.right, bottom: box.bottom };
  });
  expect(narrowLayout.left).toBeGreaterThanOrEqual(16);
  expect(narrowLayout.right).toBeLessThanOrEqual(374);
  expect(narrowLayout.bottom).toBeLessThanOrEqual(676);
  expect(narrowLayout.bodyScrollHeight).toBeLessThanOrEqual(narrowLayout.bodyHeight + 1);
  await dialog.screenshot({ path: testInfo.outputPath("batch-dialog-narrow.png") });
  expect(browserErrors).toEqual([]);
});

test("从批量任务打开转写中的详情时只显示转写状态", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const batchId = "batch-running-transcription";
  const batchSnapshot = {
    batch_id: batchId,
    client_request_id: "request-running-transcription",
    created_at: "2026-09-20T08:00:00Z",
    items: [
      {
        cancelled: false,
        input_index: 0,
        result_available: true,
        source_url: needsTranscriptItem.source_url,
        stage: "recognize",
        status: "running",
        task_id: "processing-running-transcription",
        title: needsTranscriptItem.title,
        updated_at: "2026-09-20T08:00:01Z",
        video_id: needsTranscriptItem.video_id
      }
    ],
    stats: { active: 1, cancelled: 0, failed: 0, succeeded: 0, total: 1 },
    success: true
  };

  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/task-batches**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/task-batches") {
      return json(route, {
        active_task_count: 1,
        active_video_ids: [needsTranscriptItem.video_id],
        batches: [
          {
            batch_id: batchId,
            created_at: batchSnapshot.created_at,
            stats: batchSnapshot.stats
          }
        ],
        success: true
      });
    }
    if (path === `/api/task-batches/${batchId}`) {
      return json(route, batchSnapshot);
    }
    return route.fallback();
  });
  await page.goto("/");

  await page.getByRole("button", { name: "任务 · 1", exact: true }).click();
  await page.getByRole("button", { name: "查看", exact: true }).click();

  await expect(page.getByRole("heading", { name: "正在生成转写稿" })).toBeVisible();
  await expect(page.getByText("转写任务正在后台处理，完成后会自动更新当前内容。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成转写稿", exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("转写总结期间最近档案显示处理中", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let libraryPhase: "needs-transcript" | "transcribed" | "summarized" =
    "needs-transcript";
  let releaseTranscribe!: () => void;
  let releaseSummary!: () => void;
  const transcribeGate = new Promise<void>((resolve) => {
    releaseTranscribe = resolve;
  });
  const summaryGate = new Promise<void>((resolve) => {
    releaseSummary = resolve;
  });

  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/library/recent**", (route) =>
    json(route, {
      items: [
        libraryPhase === "summarized"
          ? processedNeedsTranscriptItem
          : libraryPhase === "transcribed"
            ? {
                ...needsTranscriptItem,
                has_transcript: true,
                summary_model: null,
                summary_status: "none",
                text_source_type: "asr_transcript"
              }
            : needsTranscriptItem,
        summarizedItem
      ],
      success: true
    })
  );
  await page.route("http://127.0.0.1:8000/api/transcribe", async (route) => {
    await transcribeGate;
    libraryPhase = "transcribed";
    return json(route, {
      message: "转写稿已生成。",
      source_url: needsTranscriptItem.source_url,
      success: true,
      transcript: generatedTranscript,
      transcript_variant_key: "sensevoice_small",
      video_id: needsTranscriptItem.video_id
    });
  });
  await page.route("http://127.0.0.1:8000/api/summarize", async (route) => {
    await summaryGate;
    libraryPhase = "summarized";
    return json(route, {
      is_ai_generated: true,
      mindmap_markdown: "# 自动总结",
      mindmap_meta: null,
      model: "deepseek-chat",
      success: true,
      summary: {
        ...emptySummary,
        tldr: "自动总结已经完成。"
      }
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "需转写演示", exact: true }).click();
  await page.getByRole("button", { name: "生成转写稿", exact: true }).click();
  await page
    .getByRole("dialog", { name: "转写设置" })
    .getByRole("button", { name: "开始转写", exact: true })
    .click();
  await page.locator('button[title="返回首页"]').click();

  await expect(page.getByText("处理中", { exact: true })).toBeVisible();
  releaseTranscribe();
  await expect.poll(() => libraryPhase).toBe("transcribed");
  await expect(page.getByText("处理中", { exact: true })).toBeVisible();
  releaseSummary();
  await expect(page.getByText("已总结", { exact: true })).toBeVisible();
  await expect(page.getByText("处理中", { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("刷新后恢复档案处理状态并继续总结", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let isSummarized = false;
  let summaryRequested = false;
  let releaseSummary!: () => void;
  const summaryGate = new Promise<void>((resolve) => {
    releaseSummary = resolve;
  });

  await page.addInitScript(
    ({ key, workflow }) => {
      window.sessionStorage.setItem(key, JSON.stringify([workflow]));
    },
    {
      key: LIBRARY_PROCESSING_STORAGE_KEY,
      workflow: {
        sourceUrl: needsTranscriptItem.source_url,
        startedAt: Date.now(),
        videoId: needsTranscriptItem.video_id
      }
    }
  );
  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/library/recent**", (route) =>
    json(route, {
      items: [
        isSummarized
          ? processedNeedsTranscriptItem
          : {
              ...needsTranscriptItem,
              has_transcript: true,
              summary_model: null,
              summary_status: "none",
              text_source_type: "asr_transcript"
            },
        summarizedItem
      ],
      success: true
    })
  );
  await page.route(
    `http://127.0.0.1:8000/api/library/${needsTranscriptItem.video_id}`,
    (route) => json(route, transcribedNeedsTranscriptDetail)
  );
  await page.route("http://127.0.0.1:8000/api/summarize", async (route) => {
    summaryRequested = true;
    await summaryGate;
    isSummarized = true;
    return json(route, {
      is_ai_generated: true,
      mindmap_markdown: "# 恢复后的自动总结",
      mindmap_meta: null,
      model: "deepseek-chat",
      success: true,
      summary: {
        ...emptySummary,
        tldr: "刷新恢复后总结已经完成。"
      }
    });
  });

  await page.goto("/");
  await expect(page.getByText("处理中", { exact: true })).toBeVisible();
  await expect.poll(() => summaryRequested).toBe(true);
  releaseSummary();

  await expect(page.getByText("已总结", { exact: true })).toBeVisible();
  await expect(page.getByText("处理中", { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        LIBRARY_PROCESSING_STORAGE_KEY
      )
    )
    .toBeNull();
  expect(browserErrors).toEqual([]);
});
