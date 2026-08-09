import { expect, test, type Page, type Route } from "@playwright/test";

const summarizedItem = {
  author: "测试作者",
  duration: 180,
  has_transcript: true,
  platform: "bilibili",
  source_url: "https://example.com/summarized",
  summary_model: "deepseek-chat",
  summary_status: "ai_generated",
  text_source_type: "subtitle",
  thumbnail: "",
  title: "已总结演示",
  updated_at: "2026-08-09T10:00:00+08:00",
  video_id: "summarized-item"
};

const needsTranscriptItem = {
  author: "测试作者",
  duration: 240,
  has_transcript: false,
  platform: "bilibili",
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
    plain_text: "",
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
        cloud_available: false,
        cloud_model: "fun-asr-flash",
        cloud_provider: "aliyun",
        correction_available: true,
        correction_message: null,
        recommended_engine: "sensevoice_small",
        sensevoice_available: true,
        sensevoice_message: null,
        sensevoice_model: "iic/SenseVoiceSmall",
        success: true,
        whisper_model: "large-v3-turbo"
      });
    }
    if (path === "/api/library/recent") {
      if (libraryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, libraryDelayMs));
      }
      return json(route, {
        items: [needsTranscriptItem, summarizedItem],
        success: true
      });
    }
    if (path === "/api/library/stats") {
      return json(route, {
        ai_summary_count: 1,
        fallback_summary_count: 0,
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

test("最近档案先显示加载态，并保持已总结与需转写互斥", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page, 450);
  await page.goto("/");

  await expect(page.getByRole("status", { name: "正在加载最近档案" })).toBeVisible();
  await expect(page.getByText("暂无本地历史记录")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "已总结 · 1" })).toBeVisible();

  await page.getByRole("button", { name: "已总结 · 1" }).click();
  await expect(page.getByRole("button", { name: "已总结演示", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "需转写演示", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "需转写 · 1" }).click();
  await expect(page.getByRole("button", { name: "需转写演示", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "已总结演示", exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("无逐字稿详情隐藏旧总结，转写弹窗和术语删除保持单层任务", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let nativeDialogOpened = false;
  page.on("dialog", async (dialog) => {
    nativeDialogOpened = true;
    await dialog.dismiss();
  });
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "需转写 · 1" }).click();
  await page.getByRole("button", { name: "需转写演示", exact: true }).click();
  await expect(page.getByRole("heading", { name: "未生成总结" })).toBeVisible();
  await expect(page.getByText("不应展示的旧总结")).toHaveCount(0);

  const transcribeButton = page.getByRole("button", { name: "生成转写稿", exact: true });
  await transcribeButton.click();
  await expect(page.getByRole("dialog", { name: "转写设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭转写设置" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await page.getByRole("button", { name: "管理与选择术语库" }).click();
  await page.getByRole("button", { name: "删除所选" }).click();
  await expect(page.getByText("删除选中的 1 个术语？")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(nativeDialogOpened).toBe(false);

  await page.getByRole("button", { name: "取消", exact: true }).first().click();
  await page.getByRole("button", { name: "关闭转写设置" }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(transcribeButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
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
    .getByRole("button", { name: "管理记录：需转写演示", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除记录" }).click();
  await expect(page.getByRole("dialog", { name: "删除《需转写演示》？" })).toBeVisible();
  expect(nativeDialogOpened).toBe(false);

  await page.getByRole("button", { name: "关闭删除《需转写演示》？" }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "需转写演示", exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
