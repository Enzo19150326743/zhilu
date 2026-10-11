import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { LIBRARY_PROCESSING_STORAGE_KEY } from "../lib/library-processing";

const verticalThumbnail = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#d6c7a1"/></svg>'
)}`;

const summarizedItem = {
  author: "测试作者",
  duration: 180,
  has_transcript: true,
  platform: "bilibili",
  source_url: "https://example.com/summarized",
  summary_model: "deepseek-chat",
  summary_status: "ai_generated",
  text_source_type: "asr_transcript",
  thumbnail: "",
  title: "已总结演示",
  updated_at: "2026-08-09T10:00:00+08:00",
  video_id: "summarized-item"
};

const needsTranscriptItem = {
  author: "测试作者",
  duration: 240,
  has_transcript: false,
  platform: "xiaohongshu",
  source_url: "https://example.com/needs-transcript",
  summary_model: "deepseek-chat",
  summary_status: "ai_generated",
  text_source_type: null,
  thumbnail: "",
  title: "需转写演示",
  updated_at: "2026-08-09T11:00:00+08:00",
  video_id: "needs-transcript-item"
};

const emptySummary = {
  key_points: [],
  structured_analysis_markdown: "",
  takeaways: [],
  timeline: [],
  tldr: "不应展示的旧总结",
  to_confirm: []
};

const needsTranscriptDetail = {
  active_transcript_variant: null,
  formats: [],
  is_from_cache: true,
  is_placeholder: false,
  library_summary_model: "deepseek-chat",
  library_summary_status: "ai_generated",
  mindmap_markdown: "",
  note_draft: null,
  source_url: needsTranscriptItem.source_url,
  success: true,
  summary: emptySummary,
  transcript: {
    plain_text: "未检测到可用 VTT/SRT 字幕。",
    segments: []
  },
  transcript_variants: {},
  video: {
    author: needsTranscriptItem.author,
    duration: needsTranscriptItem.duration,
    has_transcript: false,
    media_type: "video",
    platform: needsTranscriptItem.platform,
    text_source_type: null,
    thumbnail: "",
    title: needsTranscriptItem.title,
    url: needsTranscriptItem.source_url,
    video_id: needsTranscriptItem.video_id
  }
};

const generatedTranscript = {
  asr_meta: { correction_status: "corrected", engine: "sensevoice" },
  plain_text: "这是刚刚生成的完整转写稿。",
  segments: [{ start: 0, text: "这是刚刚生成的完整转写稿。" }]
};

const transcribedNeedsTranscriptDetail = {
  ...needsTranscriptDetail,
  active_transcript_variant: "sensevoice_small",
  library_summary_model: null,
  library_summary_status: "none",
  transcript: generatedTranscript,
  transcript_variants: { sensevoice_small: generatedTranscript },
  video: {
    ...needsTranscriptDetail.video,
    has_transcript: true,
    text_source_type: "asr_transcript"
  }
};

const processedNeedsTranscriptItem = {
  ...needsTranscriptItem,
  has_transcript: true,
  summary_status: "ai_generated",
  text_source_type: "asr_transcript"
};

const summarizedDetail = {
  ...needsTranscriptDetail,
  active_transcript_variant: "corrected",
  mindmap_markdown: "# 测试主题\n## 第一分支\n### 关键结论",
  source_url: summarizedItem.source_url,
  summary: {
    ...emptySummary,
    key_points: ["关键结论"],
    key_point_evidence: [
      {
        excerpt: "用于验证导图工具提示位置。",
        point_index: 0,
        segment_ids: ["seg-0001-test"],
        transcript_fingerprint: "sha256:test"
      }
    ],
    transcript_fingerprint: "sha256:test",
    structured_analysis_markdown:
      "## 论证与方法\n1. **提升判断力** → 通过调查研究看清方向。",
    tldr: "用于验证导图工具提示位置。"
  },
  transcript: {
    asr_meta: { correction_status: "corrected", engine: "sensevoice" },
    fingerprint: "sha256:test",
    plain_text: "用于验证导图工具提示位置。",
    segments: [{ start: 0, text: "用于验证导图工具提示位置。" }]
  },
  transcript_variants: {
    corrected: {
      asr_meta: { correction_status: "corrected", engine: "sensevoice" },
      fingerprint: "sha256:test",
      plain_text: "用于验证导图工具提示位置。",
      segments: [{ start: 0, text: "用于验证导图工具提示位置。" }]
    }
  },
  video: {
    ...needsTranscriptDetail.video,
    author: summarizedItem.author,
    has_transcript: true,
    source_url: summarizedItem.source_url,
    text_source_type: "asr_transcript",
    thumbnail: verticalThumbnail,
    title: summarizedItem.title,
    url: summarizedItem.source_url,
    video_id: summarizedItem.video_id
  }
};

const correctionLibrary = {
  folders: [
    {
      created_at: "2026-08-01T00:00:00Z",
      id: 1,
      name: "产品",
      updated_at: "2026-08-01T00:00:00Z"
    }
  ],
  success: true,
  terms: [
    {
      created_at: "2026-08-01T00:00:00Z",
      folder_id: 1,
      id: 1,
      last_used_at: "2026-08-09T00:00:00Z",
      text: "Codex",
      updated_at: "2026-08-09T00:00:00Z",
      usage_count: 3
    }
  ]
};

function json(route: Route, body: unknown) {
  return route.fulfill({
    body: JSON.stringify(body),
    headers: {
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "content-type": "application/json"
    },
    status: 200
  });
}

async function installApiMocks(page: Page, libraryDelayMs = 0) {
  await page.route("http://127.0.0.1:8000/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;

    if (path === "/api/demo") {
      return json(route, { demos: [], success: true });
    }
    if (path === "/api/asr/status") {
      return json(route, {
        correction_available: true,
        correction_message: null,

        sensevoice_available: true,
        sensevoice_message: null,
        sensevoice_model: "iic/SenseVoiceSmall",
        success: true,

      });
    }
    if (path === "/api/library/recent") {
      if (libraryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, libraryDelayMs));
      }
      const filter = requestUrl.searchParams.get("filter") ?? "all";
      const items =
        filter === "summarized"
          ? [summarizedItem]
          : filter === "noTranscript"
            ? [needsTranscriptItem]
            : filter === "ready"
              ? []
              : [needsTranscriptItem, summarizedItem];
      return json(route, {
        items,
        success: true
      });
    }
    if (path === "/api/library/stats") {
      return json(route, {
        ai_summary_count: 1,
        fallback_summary_count: 0,
        needs_transcript_count: 1,
        ready_count: 0,
        no_transcript_count: 1,
        success: true,
        summarized_count: 1,
        total_items: 2,
        with_transcript_count: 1
      });
    }
    if (path === `/api/library/${needsTranscriptItem.video_id}`) {
      return json(route, needsTranscriptDetail);
    }
    if (path === `/api/library/${summarizedItem.video_id}`) {
      return json(route, summarizedDetail);
    }
    if (path === "/api/correction-terms") {
      return json(route, correctionLibrary);
    }

    return json(route, { success: true });
  });
}

function watchBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function getRenderedTextCenter(locator: Locator) {
  return locator.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    return box.x + box.width / 2;
  });
}

test("快速体验保留接口返回的推荐摘要与导图，不误报未生成总结", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/demo", (route) => json(route, {
    success: true,
    demos: [{ demo_id: "public-demo", title: "公开推荐内容", description: "推荐内容", thumbnail: "" }]
  }));
  await page.route("http://127.0.0.1:8000/api/demo/public-demo", (route) =>
    json(route, { ...summarizedDetail, library_summary_status: "local_fallback" })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "公开推荐内容 推荐内容", exact: true }).click();
  await expect(page.getByText("推荐摘要", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "一句话结论" })).toContainText(summarizedDetail.summary.tldr);
  await expect(page.getByRole("heading", { name: "未生成总结" })).toHaveCount(0);
  await page.getByRole("tab", { name: "思维导图", exact: true }).click();
  await expect(page.getByRole("button", { name: "重置导图视图", exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText("第一分支", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.getByRole("button", { name: "需转写演示", exact: true }).click();
  await expect(page.getByRole("heading", { name: "未生成总结" })).toBeVisible();
  await expect(page.getByText("推荐摘要", { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("最近档案先显示加载态，并保持已总结与需转写互斥", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page, 450);
  await page.goto("/");

  await expect(page.getByRole("status", { name: "正在加载最近档案" })).toBeVisible();
  await expect(page.getByText("暂无本地历史记录")).toHaveCount(0);
  await expect(page.getByText(/本地保存 \d+ 条内容/)).toHaveCount(0);
  await expect(page.getByText("无需准备链接，直接打开示例。", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "已总结 1" })).toBeVisible();

  await page.getByRole("button", { name: "已总结 1" }).click();
  await expect(page.getByRole("button", { name: "已总结演示", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "需转写演示", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "需转写 1" }).click();
  await expect(page.getByRole("button", { name: "需转写演示", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "已总结演示", exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("最近档案的辅助列与操作列表头和内容共用中心线", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  const needsTranscriptRow = page.getByRole("button", { name: "需转写演示", exact: true }).locator("..");
  await expect(needsTranscriptRow).toBeVisible();
  const sourceHeader = page.getByText("来源", { exact: true });
  const sourceCell = needsTranscriptRow.locator(":scope > span").nth(0);
  const statusHeader = page.getByText("状态", { exact: true });
  const statusCell = needsTranscriptRow.locator(":scope > span").nth(1);
  const timeHeader = page.getByText("时间", { exact: true });
  const timeCell = needsTranscriptRow.locator(":scope > span").nth(2);
  const operationHeader = page.getByText("操作", { exact: true });
  const [sourceHeaderCenter, sourceCellCenter, statusHeaderCenter, statusCellCenter, timeHeaderCenter, timeCellCenter, operationHeaderCenter, copyButton, deleteButton] =
    await Promise.all([
      getRenderedTextCenter(sourceHeader),
      getRenderedTextCenter(sourceCell),
      getRenderedTextCenter(statusHeader),
      getRenderedTextCenter(statusCell),
      getRenderedTextCenter(timeHeader),
      getRenderedTextCenter(timeCell),
      getRenderedTextCenter(operationHeader),
      page.getByRole("button", { name: "复制源链接", exact: true }).first().boundingBox(),
      page.getByRole("button", { name: "删除《需转写演示》", exact: true }).boundingBox()
    ]);

  expect(copyButton).not.toBeNull();
  expect(deleteButton).not.toBeNull();

  expect(Math.abs(sourceHeaderCenter - sourceCellCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(statusHeaderCenter - statusCellCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(timeHeaderCenter - timeCellCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(operationHeaderCenter - ((copyButton!.x + deleteButton!.x + deleteButton!.width) / 2))).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
});

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

test("最近档案操作提示只在对应图标上悬停时显示", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  const itemButton = page.getByRole("button", {
    name: "需转写演示",
    exact: true
  });
  const deleteButton = page.getByRole("button", {
    name: "删除《需转写演示》",
    exact: true
  });
  const deleteTooltip = deleteButton.locator("..").getByRole("tooltip", {
    name: "删除档案",
    exact: true
  });

  await itemButton.hover();
  await expect(deleteTooltip).toHaveCSS("opacity", "0");

  await deleteButton.hover();
  await expect(deleteTooltip).toHaveCSS("opacity", "1");
  expect(browserErrors).toEqual([]);
});

test("转写弹窗明确引导可选说话人并只保留术语记忆", async ({ page }, testInfo) => {
  const browserErrors = watchBrowserErrors(page);
  let nativeDialogOpened = false;
  page.on("dialog", async (dialog) => {
    nativeDialogOpened = true;
    await dialog.dismiss();
  });
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "需转写演示", exact: true }).click();
  await expect(page.getByRole("heading", { name: "未生成总结" })).toBeVisible();
  await expect(page.getByText("不应展示的旧总结")).toHaveCount(0);

  const transcribeButton = page.getByRole("button", { name: "生成转写稿", exact: true });
  await transcribeButton.click();
  const transcribeDialog = page.getByRole("dialog", { name: "转写设置" });
  await expect(transcribeDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭转写设置" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await expect(
    transcribeDialog.getByRole("heading", { name: "转写设置" })
  ).toHaveClass(/\bsr-only\b/);
  await expect(transcribeDialog.getByText("需转写演示", { exact: true })).toHaveCount(0);
  await expect(transcribeDialog.getByText("推荐", { exact: true })).toHaveCount(0);
  await expect(transcribeDialog.getByText("iic/SenseVoiceSmall", { exact: true })).toHaveCount(0);
  await expect(
    transcribeDialog.getByRole("button", { name: "云端快速识别", exact: true })
  ).toHaveCount(0);
  await expect(transcribeDialog.getByText(/用于改善标点、断句/)).toHaveCount(0);
  await expect(transcribeDialog.getByText("本期术语", { exact: true })).toBeVisible();
  await expect(transcribeDialog.getByText("已选 0/120", { exact: true })).toHaveCount(0);
  await expect(transcribeDialog.getByText("识别方式", { exact: true })).toHaveCount(0);
  await expect(transcribeDialog.getByRole("combobox")).toHaveCount(0);
  await expect(
    transcribeDialog.getByRole("button", { name: "取消", exact: true })
  ).toHaveCount(0);
  await expect(
    transcribeDialog.getByRole("button", { name: "开始转写", exact: true })
  ).toBeVisible();
  const supplement = transcribeDialog
    .locator("details", { hasText: "补充识别信息" })
    .first();
  await expect(supplement).toHaveCSS("border-top-width", "2px");
  expect(
    await supplement.evaluate((element) => getComputedStyle(element).boxShadow)
  ).not.toBe("none");
  await expect(
    transcribeDialog.getByRole("button", { name: "AI / 科技", exact: true })
  ).toBeHidden();
  await transcribeDialog.screenshot({ path: testInfo.outputPath("transcribe-settings.png") });

  await transcribeDialog
    .getByRole("button", { name: "双人访谈", exact: true })
    .click();
  await expect(transcribeDialog.getByText("已按双人访谈识别")).toBeVisible();
  const optionalSpeakerButton = transcribeDialog.getByRole("button", {
    name: "补充说话人（可选）",
    exact: true
  });
  await expect(optionalSpeakerButton).toBeVisible();
  await expect(
    transcribeDialog.getByRole("button", { name: "开始转写", exact: true })
  ).toBeEnabled();
  await expect(
    transcribeDialog.getByRole("button", { name: "AI / 科技", exact: true })
  ).toBeHidden();

  await optionalSpeakerButton.click();
  await expect(
    transcribeDialog.getByRole("button", { name: "AI / 科技", exact: true })
  ).toBeVisible();
  const speakerNameInputs = transcribeDialog.getByPlaceholder("姓名（如知道）");
  await expect(speakerNameInputs.first()).toBeFocused();
  await expect(speakerNameInputs).toHaveCount(2);
  await expect(speakerNameInputs.first()).toHaveValue("主持人");
  await speakerNameInputs.first().fill("小王");
  await transcribeDialog
    .getByRole("button", { name: "多人聊天 / 圆桌", exact: true })
    .click();
  await expect(speakerNameInputs.first()).toHaveValue("小王");
  await expect(speakerNameInputs).toHaveCount(3);

  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(transcribeDialog.getByText("已选 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "管理术语库" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(nativeDialogOpened).toBe(false);
  await transcribeDialog.screenshot({ path: testInfo.outputPath("transcribe-speakers.png") });

  await page.getByRole("button", { name: "关闭转写设置" }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(transcribeButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  expect(browserErrors).toEqual([]);
});

test("转写入口只根据 SenseVoice 可用状态启用，且不展示模型选择", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  let available = true;
  await page.route("**/api/asr/status", async (route) => {
    await route.fulfill({ json: {
      success: true, sensevoice_available: available,
      sensevoice_model: "iic/SenseVoiceSmall", correction_available: true
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "需转写演示", exact: true }).click();
  await page.getByRole("button", { name: "生成转写稿", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "转写设置" });
  await expect(dialog.getByRole("button", { name: "开始转写", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭转写设置" }).click();
  available = false;
  await page.getByRole("button", { name: "生成转写稿", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "开始转写", exact: true })).toBeDisabled();
  expect(browserErrors).toEqual([]);
});

test("小红书占位字幕不会阻断统一生成转写稿入口", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "需转写 1" }).click();
  await page.getByRole("button", { name: "需转写演示", exact: true }).click();

  for (const tabName of ["总结", "思维导图", "内容问答", "内容文本"]) {
    await page.getByRole("tab", { name: tabName, exact: true }).click();
    const activePanel = page.getByRole("tabpanel", {
      name: `${tabName}内容`,
      exact: true
    });
    const transcribeButton = activePanel.getByRole("button", {
      name: "生成转写稿",
      exact: true
    });

    await expect(transcribeButton).toHaveCount(1);
    await expect(
      activePanel.getByText("转写设置", { exact: true })
    ).toHaveCount(0);
    await transcribeButton.click();
    await expect(page.getByRole("dialog", { name: "转写设置" })).toBeVisible();
    await page.getByRole("button", { name: "关闭转写设置" }).click();
  }

  expect(browserErrors).toEqual([]);
});

test("资料库危险操作使用站内确认并可取消", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let nativeDialogOpened = false;
  page.on("dialog", async (dialog) => {
    nativeDialogOpened = true;
    await dialog.dismiss();
  });
  await installApiMocks(page);
  await page.goto("/");

  await page
    .getByRole("button", { name: "删除《需转写演示》", exact: true })
    .click();
  const deleteDialog = page.getByRole("dialog", { name: "删除档案" });
  await expect(deleteDialog).toBeVisible();
  await expect(
    deleteDialog.getByRole("heading", { name: "删除档案" })
  ).toHaveClass(/\bsr-only\b/);
  await expect(
    deleteDialog.getByRole("button", { name: "关闭删除档案" })
  ).toHaveCount(0);
  await expect(
    deleteDialog.getByText("删除这条档案？", { exact: true })
  ).toBeVisible();
  await expect(
    deleteDialog.getByRole("button", { name: "删除", exact: true })
  ).toBeVisible();
  expect(
    await deleteDialog.evaluate((element) => element.getBoundingClientRect().width)
  ).toBeLessThanOrEqual(400);
  expect(nativeDialogOpened).toBe(false);

  const deleteCancelButton = deleteDialog.getByRole("button", {
    name: "取消",
    exact: true
  });
  await expect(deleteCancelButton).toBeFocused();
  await deleteCancelButton.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "需转写演示", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "清空全部档案", exact: true }).click();
  const clearDialog = page.getByRole("dialog", { name: "清空全部档案" });
  await expect(clearDialog).toBeVisible();
  await expect(
    clearDialog.getByText("清空全部档案？此操作无法撤销。", { exact: true })
  ).toBeVisible();
  await expect(
    clearDialog.getByRole("button", { name: "清空", exact: true })
  ).toBeVisible();
  await clearDialog.getByRole("button", { name: "取消", exact: true }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 740 });
  await page
    .getByRole("button", { name: "删除《需转写演示》", exact: true })
    .click();
  const mobileDialogBox = await page
    .getByRole("dialog", { name: "删除档案" })
    .boundingBox();
  expect(mobileDialogBox).not.toBeNull();
  expect(mobileDialogBox!.width).toBeLessThanOrEqual(328);
  await page
    .getByRole("dialog", { name: "删除档案" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("一句话结论使用顶部横向强调线", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  const tldrRegion = page.getByRole("region", { name: "一句话结论" });
  const accent = tldrRegion.locator('[data-summary-accent="true"]');
  const accentBox = await accent.boundingBox();
  expect(accentBox).not.toBeNull();
  expect(accentBox!.width).toBeGreaterThan(accentBox!.height);
  expect(browserErrors).toEqual([]);
});

test("工作台输入聚焦克制且完整转写不再提供重新转写", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();
  await page.getByRole("tab", { name: "内容问答", exact: true }).click();

  await expect(
    page.getByText("仅根据当前内容回答，不确定处会说明。", { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/无法从文本确认的信息/)).toHaveCount(0);
  const qaInput = page.getByPlaceholder("使用快速模式向内容提问...");
  const qaForm = qaInput.locator("xpath=ancestor::form[1]");
  const qaFrameColor = await qaForm.evaluate(
    (element) => getComputedStyle(element).borderTopColor
  );
  await qaInput.focus();
  await expect(qaInput).toHaveCSS("outline-style", "none");
  await expect(qaInput).toHaveCSS("border-top-color", qaFrameColor);

  await page.getByRole("tab", { name: "内容文本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新转写", exact: true })
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("导图工具提示只在悬停时向下展开", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  await expect(
    page.locator("strong").filter({ hasText: "提升判断力" })
  ).toHaveText("提升判断力");
  await expect(page.getByText("**提升判断力**", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新生成知识稿", exact: true })
  ).toHaveCount(0);
  await expect(page.getByText(/已直接返回历史结果/)).toHaveCount(0);

  await page.getByRole("tab", { name: "内容文本", exact: true }).click();
  await expect(
    page.getByText(/当前默认展示校对稿，可切换查看/)
  ).toHaveCount(0);
  await expect(page.getByPlaceholder("输入关键词，定位原文")).toBeVisible();

  await page.getByRole("tab", { name: "思维导图", exact: true }).click();

  const mindmapPanel = page.getByRole("tabpanel", { name: "思维导图内容" });
  await expect(mindmapPanel.getByText("通用内容", { exact: true })).toHaveCount(0);
  await expect(mindmapPanel.getByText("视频", { exact: true })).toHaveCount(0);
  await expect(mindmapPanel.getByText("转写稿", { exact: true })).toHaveCount(0);
  const mindmapHeadingRow = mindmapPanel.getByText("树状导图", { exact: true }).locator("..");
  await expect(mindmapHeadingRow).toHaveCSS("border-bottom-width", "0px");

  const canvas = page.locator('svg[aria-label="智能树状导图"]').locator("..");
  await expect(
    page.getByRole("button", { name: "放大导图", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "缩小导图", exact: true })
  ).toHaveCount(0);
  const resetButton = page.getByRole("button", {
    name: "重置导图视图",
    exact: true
  });
  const tooltip = page.getByRole("tooltip", {
    name: "重置导图视图",
    exact: true
  });
  await resetButton.hover();
  await expect(tooltip).toHaveCSS("opacity", "1");

  const [canvasBox, tooltipBox] = await Promise.all([
    canvas.boundingBox(),
    tooltip.boundingBox()
  ]);
  expect(canvasBox).not.toBeNull();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);

  await resetButton.click();
  await page.locator('svg[aria-label="智能树状导图"]').hover({
    position: { x: 12, y: 180 }
  });
  await expect(tooltip).toHaveCSS("opacity", "0");

  const fullscreenButton = page.getByRole("button", {
    name: "全屏查看导图",
    exact: true
  });
  const fullscreenTooltip = page.getByRole("tooltip", {
    name: "全屏查看导图",
    exact: true
  });
  await fullscreenButton.hover();
  await expect(fullscreenTooltip).toHaveCSS("opacity", "1");
  await expect(tooltip).toHaveCSS("opacity", "0");

  await expect(
    page.getByRole("button", { name: "适应导图画布", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重置导图视图", exact: true })
  ).toBeVisible();

  await page.getByText("第一分支", { exact: true }).click();
  const highlightRect = page.locator("g.markmap-highlight rect");
  await expect(highlightRect).toHaveCount(0);
  await expect(
    mindmapPanel.getByText("拖拽平移，滚轮缩放，点击节点展开或收起", {
      exact: true
    })
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("后台单条任务就绪时不替换正在阅读的其他文章", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let submitted = false;
  let pollCount = 0;
  const snapshot = (completed = false, withVideo = false) => ({
    batch_id: "quiet-batch", client_request_id: "quiet-request",
    created_at: "2026-10-08T08:00:00Z",
    items: [{
      cancelled: false, input_index: 0, result_available: withVideo,
      source_url: needsTranscriptItem.source_url,
      stage: completed ? "done" : withVideo ? "recognize" : "parse",
      status: completed ? "succeeded" : "running",
      task_id: "quiet-processing-item",
      updated_at: `2026-10-08T08:00:0${completed ? 3 : withVideo ? 2 : 1}Z`,
      video_id: withVideo ? needsTranscriptItem.video_id : null
    }],
    stats: { active: completed ? 0 : 1, cancelled: 0, failed: 0, succeeded: completed ? 1 : 0, total: 1 },
    success: true
  });
  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/task-batches**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/task-batches" && route.request().method() === "POST") {
      submitted = true;
      return json(route, snapshot());
    }
    if (path === "/api/task-batches") {
      return json(route, {
        active_task_count: submitted && pollCount < 2 ? 1 : 0,
        active_video_ids: submitted && pollCount < 2 ? [needsTranscriptItem.video_id] : [],
        batches: [], success: true
      });
    }
    pollCount += 1;
    return json(route, snapshot(pollCount >= 2, true));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();
  await page.getByRole("tab", { name: "内容文本", exact: true }).click();
  const input = page.getByRole("textbox", { name: "公开媒体链接" });
  await input.fill(needsTranscriptItem.source_url);
  await page.getByRole("button", { name: "提炼内容", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect.poll(() => pollCount).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("heading", { name: summarizedItem.title, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "原文", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: needsTranscriptItem.title, exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("首页可逐条提交并保留后台任务解析期间的新输入", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const firstUrl = "https://example.com/first-podcast";
  const secondUrl = "https://example.com/second-podcast";
  const submitted: Record<string, unknown>[] = [];
  let firstPollCount = 0;

  const snapshot = (index: number, withVideo = false) => ({
    batch_id: `continuous-batch-${index}`,
    client_request_id: String(submitted[index - 1]?.client_request_id ?? "request"),
    created_at: "2026-10-08T08:00:00Z",
    items: [{
      cancelled: false,
      input_index: 0,
      result_available: withVideo,
      source_url: index === 1 ? firstUrl : secondUrl,
      stage: withVideo ? "recognize" : "parse",
      status: "running",
      task_id: `continuous-item-${index}`,
      updated_at: `2026-10-08T08:00:0${withVideo ? 2 : 1}Z`,
      video_id: withVideo ? "first-podcast" : null
    }],
    stats: { active: 1, cancelled: 0, failed: 0, succeeded: 0, total: 1 },
    success: true
  });

  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/task-batches**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/task-batches" && route.request().method() === "POST") {
      submitted.push(route.request().postDataJSON());
      return json(route, snapshot(submitted.length));
    }
    if (path === "/api/task-batches") {
      return json(route, {
        active_task_count: submitted.length,
        active_video_ids: firstPollCount > 0 ? ["first-podcast"] : [],
        batches: submitted.map((_body, index) => ({
          batch_id: `continuous-batch-${index + 1}`,
          created_at: "2026-10-08T08:00:00Z",
          stats: snapshot(index + 1).stats
        })),
        success: true
      });
    }
    if (path === "/api/task-batches/continuous-batch-1") {
      firstPollCount += 1;
      return json(route, snapshot(1, true));
    }
    return json(route, snapshot(2));
  });
  await page.route("http://127.0.0.1:8000/api/library/first-podcast", (route) =>
    json(route, {
      ...needsTranscriptDetail,
      source_url: firstUrl,
      video: { ...needsTranscriptDetail.video, url: firstUrl, video_id: "first-podcast" }
    })
  );
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "公开媒体链接" });
  await input.fill(firstUrl);
  await page.getByRole("button", { name: "提炼内容", exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  await expect(input).toHaveValue("");
  await input.fill(secondUrl);
  await expect.poll(() => firstPollCount).toBeGreaterThan(0);
  await expect(input).toHaveValue(secondUrl);
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "提炼内容", exact: true })).toBeEnabled();
  await input.press("Enter");
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted.map((body) => body.urls)).toEqual([[firstUrl], [secondUrl]]);
  expect(submitted[0].client_request_id).not.toBe(submitted[1].client_request_id);
  await expect(page.getByRole("button", { name: "任务 · 2", exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("工作台可逐条提交且旧任务响应不会覆盖下一条草稿或详情", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  const firstUrl = needsTranscriptItem.source_url;
  const secondUrl = "https://example.com/second-video";
  const thirdUrl = "https://example.com/third-video";
  const submitted: Record<string, unknown>[] = [];
  let releaseSubmission!: () => void;
  let releaseFirstDetail!: () => void;
  let firstDetailRequested = false;
  let firstDetailReadCount = 0;
  let releaseFirstList!: () => void;
  let firstListRequested = false;
  const firstListGate = new Promise<void>((resolve) => { releaseFirstList = resolve; });
  const submissionGate = new Promise<void>((resolve) => { releaseSubmission = resolve; });
  const detailGate = new Promise<void>((resolve) => { releaseFirstDetail = resolve; });
  const snapshot = (index: number) => ({
    batch_id: `sequential-batch-${index}`,
    client_request_id: String(submitted[index - 1]?.client_request_id ?? "request"),
    created_at: "2026-10-08T08:00:00Z",
    items: [{
      cancelled: false, input_index: 0, result_available: true,
      source_url: index === 1 ? firstUrl : secondUrl,
      stage: "recognize", status: "running",
      task_id: `sequential-item-${index}`,
      updated_at: "2026-10-08T08:00:01Z",
      video_id: index === 1 ? needsTranscriptItem.video_id : "second-video"
    }],
    stats: { active: 1, cancelled: 0, failed: 0, succeeded: 0, total: 1 },
    success: true
  });

  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/task-batches**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/task-batches" && route.request().method() === "POST") {
      submitted.push(route.request().postDataJSON());
      const index = submitted.length;
      if (index === 1) await submissionGate;
      return json(route, snapshot(index));
    }
    if (path === "/api/task-batches") {
      const count = submitted.length;
      if (count === 1) {
        firstListRequested = true;
        await firstListGate;
      }
      return json(route, { active_task_count: count, active_video_ids: [], batches: [], success: true });
    }
    return json(route, snapshot(path.endsWith("-1") ? 1 : 2));
  });
  await page.route(`http://127.0.0.1:8000/api/library/${needsTranscriptItem.video_id}`, async (route) => {
    firstDetailReadCount += 1;
    if (firstDetailReadCount > 1) {
      firstDetailRequested = true;
      await detailGate;
    }
    return json(route, {
      ...needsTranscriptDetail,
      video: {
        ...needsTranscriptDetail.video,
        title: firstDetailReadCount > 1 ? "第一条处理中" : needsTranscriptItem.title
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: needsTranscriptItem.title, exact: true }).click();
  const input = page.getByRole("textbox", { name: "公开媒体链接" });
  await input.fill(firstUrl);
  await input.press("Enter");
  await expect.poll(() => submitted.length).toBe(1);
  await input.fill(secondUrl);
  await input.press("Enter");
  expect(submitted).toHaveLength(1);
  await expect(input).toHaveValue(secondUrl);
  releaseSubmission();
  await expect.poll(() => firstDetailRequested).toBe(true);
  await expect.poll(() => firstListRequested).toBe(true);
  await expect(page.getByRole("button", { name: "提炼内容", exact: true })).toBeEnabled();
  await input.press("Enter");
  await expect.poll(() => submitted.length).toBe(2);
  await expect(page.getByRole("heading", { name: needsTranscriptItem.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();
  await page.getByRole("tab", { name: "内容文本", exact: true }).click();
  await input.fill(thirdUrl);
  const lateDetail = page.waitForResponse(`http://127.0.0.1:8000/api/library/${needsTranscriptItem.video_id}`);
  const lateList = page.waitForResponse(async (response) =>
    response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/task-batches" &&
    (await response.json()).active_task_count === 1
  );
  releaseFirstDetail();
  releaseFirstList();
  await Promise.all([lateDetail, lateList]);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(page.getByRole("heading", { name: "第一条处理中", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: summarizedItem.title, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "原文", exact: true })).toBeVisible();
  await expect(input).toHaveValue(thirdUrl);
  await expect(page.getByRole("button", { name: "任务 · 2", exact: true })).toBeVisible();
  expect(submitted.map((body) => body.urls)).toEqual([[firstUrl], [secondUrl]]);
  expect(browserErrors).toEqual([]);
});

test("工作台链接输入框提交单条持久提炼任务", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let taskBody: Record<string, unknown> | null = null;
  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/task-batches", async (route) => {
    if (route.request().method() === "GET") {
      return json(route, {
        active_task_count: 0,
        active_video_ids: [],
        batches: [],
        success: true
      });
    }
    taskBody = route.request().postDataJSON();
    return json(route, {
      batch_id: "single-batch-001",
      client_request_id: String(taskBody?.client_request_id ?? "request"),
      created_at: "2026-09-18T08:00:00Z",
      items: [
        {
          cancelled: false,
          input_index: 0,
          result_available: true,
          source_url: summarizedItem.source_url,
          stage: "done",
          status: "succeeded",
          task_id: "single-task-001",
          updated_at: "2026-09-18T08:00:01Z",
          video_id: summarizedItem.video_id
        }
      ],
      stats: { active: 0, cancelled: 0, failed: 0, succeeded: 1, total: 1 },
      success: true
    });
  });
  await page.goto("/");

  await expect(
    page.getByText(
      "从公开视频与播客取得文本，整理成摘要、导图和可继续编辑的 Markdown 知识稿。",
      { exact: true }
    )
  ).toHaveCount(0);

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "重新提取源内容", exact: true })
  ).toHaveCount(0);
  const urlInput = page.getByRole("textbox", { name: "公开媒体链接" });
  const inputFrame = urlInput.locator("xpath=ancestor::form[1]");
  await expect(inputFrame).toHaveCSS("border-top-width", "2px");
  const inputFrameColor = await inputFrame.evaluate(
    (element) => getComputedStyle(element).borderTopColor
  );
  await urlInput.focus();
  await expect(urlInput).toHaveCSS("outline-style", "none");
  await expect(inputFrame).toHaveCSS("border-top-color", inputFrameColor);
  const inputSection = urlInput.locator("xpath=ancestor::section[1]");
  await expect(inputSection).toHaveCSS("border-bottom-width", "0px");

  const extractButton = page.getByRole("button", {
    name: "提炼内容",
    exact: true
  });
  await expect(extractButton).toHaveCSS("background-color", "rgb(209, 75, 49)");
  await expect(extractButton).toHaveCSS("box-shadow", "none");
  await expect(extractButton.locator("svg")).toHaveCount(0);
  const [inputFrameBox, extractButtonBox] = await Promise.all([
    inputFrame.boundingBox(),
    extractButton.boundingBox()
  ]);
  expect(inputFrameBox).not.toBeNull();
  expect(extractButtonBox).not.toBeNull();
  expect(extractButtonBox!.x).toBeGreaterThan(inputFrameBox!.x);
  expect(
    Math.abs(
      extractButtonBox!.x +
        extractButtonBox!.width -
        (inputFrameBox!.x + inputFrameBox!.width)
    )
  ).toBeLessThanOrEqual(2);

  const shareText =
    "复制这段分享文案 😄 https://www.xiaohongshu.com/discovery/item/6a2761520000000008032277?source=webshare";
  await urlInput.fill(shareText);
  await extractButton.click();
  await expect.poll(() => taskBody).not.toBeNull();
  expect(taskBody).toMatchObject({
    context_settings: null,
    urls: [shareText]
  });
  expect(taskBody).not.toHaveProperty("asr_engine");
  expect(taskBody).not.toHaveProperty("target");
  await expect(page.getByRole("heading", { name: summarizedItem.title })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("总结观点可核对原文并带入就地追问", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  const evidenceButton = page.getByRole("button", { name: "查看依据", exact: true });
  await evidenceButton.hover();
  await expect(page.getByText("用于验证导图工具提示位置。", { exact: true }).first()).toBeVisible();
  await evidenceButton.click();
  await expect(page.getByRole("heading", { name: "原文依据", exact: true })).toBeVisible();
  await expect(page.getByText("不代表外部事实已核实", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "追问这条", exact: true }).click();
  const questionInput = page.getByRole("textbox", { name: "使用快速模式向内容提问..." });
  await expect(questionInput).toHaveValue(/关键结论/);
  await expect(questionInput).toHaveValue(/区分作者表达与 AI 推导/);
  expect(browserErrors).toEqual([]);
});

test("编辑我的整理后立即导出会先保存最新文字", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let savedText: string | null = null;
  let exportRequested = false;
  await installApiMocks(page);
  await page.route(
    `http://127.0.0.1:8000/api/library/${summarizedItem.video_id}`,
    (route) =>
      json(route, {
        ...summarizedDetail,
        note_draft: {
          highlights: [
            {
              id: "manual-1",
              source: "manual",
              source_type: "asr_transcript",
              tags: [],
              text: "原整理内容"
            }
          ],
          updated_at: "2026-09-18T08:00:00Z"
        }
      })
  );
  await page.route("http://127.0.0.1:8000/api/library/note-draft", (route) => {
    const body = route.request().postDataJSON() as {
      highlights: Array<{ text: string }>;
    };
    savedText = body.highlights[0]?.text ?? null;
    return json(route, {
      note_draft: {
        highlights: body.highlights,
        updated_at: "2026-09-18T08:00:01Z"
      },
      success: true
    });
  });
  await page.route("http://127.0.0.1:8000/api/exports/obsidian-note", (route) => {
    exportRequested = true;
    return json(route, {
      file_path: null,
      filename: "知识稿.md",
      markdown: "# 知识稿\n\n## 我的整理\n\n最新整理内容\n",
      message: "已生成 Markdown。",
      success: true,
      written_to_vault: false
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();
  await page.getByRole("tab", { name: "内容文本" }).click();
  await page.getByRole("button", { name: "编辑摘录", exact: true }).click();
  await page.getByRole("textbox", { name: "编辑摘录文字" }).fill("最新整理内容");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出知识稿", exact: true }).click();
  await downloadPromise;
  await expect.poll(() => savedText).toBe("最新整理内容");
  expect(exportRequested).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("工作台来源条使用紧凑缩略图并完整缩放", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  await page.getByText("来源与下载", { exact: true }).click();

  const coverFrame = page.getByTestId("media-cover-frame");
  const coverImage = coverFrame.getByRole("img", {
    name: "内容封面",
    exact: true
  });
  const backgroundImage = coverFrame.locator('img[aria-hidden="true"]');
  const coverBox = await coverFrame.boundingBox();

  expect(coverBox).not.toBeNull();
  expect(coverBox!.width).toBe(64);
  expect(coverBox!.height).toBe(64);
  await expect(backgroundImage).toHaveCount(0);
  await expect(coverImage).toHaveCSS("object-fit", "contain");
  await expect(coverImage).toHaveCSS("opacity", "1");
  await expect(coverImage).toHaveCSS("filter", "none");
  await expect(page.getByText("原始标题", { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("窄屏首页不溢出且工作台四个内容标签都可直接操作", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const label of ["总结", "思维导图", "内容问答", "内容文本"]) {
      const tab = page.getByRole("tab", { name: label, exact: true });
      await expect(tab).toBeInViewport();
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.getByRole("button", { name: "导出知识稿", exact: true })).toBeInViewport();
  }
  expect(browserErrors).toEqual([]);
});
