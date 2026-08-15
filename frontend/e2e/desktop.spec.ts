import { expect, test, type Page, type Route } from "@playwright/test";
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
    structured_analysis_markdown:
      "## 论证与方法\n1. **提升判断力** → 通过调查研究看清方向。",
    tldr: "用于验证导图工具提示位置。"
  },
  transcript: {
    asr_meta: { correction_status: "corrected", engine: "sensevoice" },
    plain_text: "用于验证导图工具提示位置。",
    segments: [{ start: 0, text: "用于验证导图工具提示位置。" }]
  },
  transcript_variants: {
    corrected: {
      asr_meta: { correction_status: "corrected", engine: "sensevoice" },
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
        needs_transcript_count: 0,
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

test("转写弹窗明确引导可选说话人并只保留术语记忆", async ({ page }) => {
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
  await expect(transcribeDialog.getByText("large-v3-turbo", { exact: true })).toHaveCount(0);
  await expect(
    transcribeDialog.getByRole("button", { name: "云端快速识别", exact: true })
  ).toHaveCount(0);
  await expect(transcribeDialog.getByText(/用于改善标点、断句/)).toHaveCount(0);
  await expect(transcribeDialog.getByText("本期术语", { exact: true })).toBeVisible();
  await expect(transcribeDialog.getByText("已选 0/120", { exact: true })).toHaveCount(0);
  const senseVoiceOption = transcribeDialog.getByRole("button", {
    name: "SenseVoice（推荐）",
    exact: true
  });
  const whisperOption = transcribeDialog.getByRole("button", {
    name: "Whisper",
    exact: true
  });
  await expect(senseVoiceOption).toContainText("中文长内容 · 较快");
  await expect(whisperOption).toContainText("多语言识别 · 较慢");
  await expect(senseVoiceOption).not.toContainText("本地");
  await expect(whisperOption).not.toContainText("本地");
  const selectedEngineBackground = await senseVoiceOption.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  const senseVoiceDescription = senseVoiceOption.getByText(
    "中文长内容 · 较快",
    { exact: true }
  );
  const selectedDescriptionColor = await senseVoiceDescription.evaluate(
    (element) => getComputedStyle(element).color
  );
  const selectedTitleColor = await senseVoiceOption
    .locator("span")
    .first()
    .evaluate((element) => getComputedStyle(element).color);
  expect(selectedDescriptionColor).not.toBe(selectedTitleColor);
  await whisperOption.click();
  await expect(whisperOption).toHaveCSS(
    "background-color",
    selectedEngineBackground
  );
  await expect(
    whisperOption.getByText("多语言识别 · 较慢", { exact: true })
  ).toHaveCSS("color", selectedDescriptionColor);
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

  await page.getByRole("button", { name: "关闭转写设置" }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(transcribeButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
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

test("一句话概览使用顶部横向强调线", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  const tldrRegion = page.getByRole("region", { name: "一句话概览" });
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

test("工作台链接输入框明确可编辑并只执行普通提取", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let parseBody: unknown = null;
  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/parse", async (route) => {
    parseBody = route.request().postDataJSON();
    return json(route, summarizedDetail);
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
    name: "提取内容",
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
  await expect.poll(() => parseBody).not.toBeNull();
  expect(parseBody).toEqual({ url: shareText });
  expect(browserErrors).toEqual([]);
});

test("工作台视频封面使用克制固定画布并完整缩放", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  await installApiMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "已总结 1" }).click();
  await page.getByRole("button", { name: "已总结演示", exact: true }).click();

  const coverFrame = page.getByTestId("media-cover-frame");
  const coverImage = coverFrame.getByRole("img", {
    name: "已总结演示 封面",
    exact: true
  });
  const backgroundImage = coverFrame.locator('img[aria-hidden="true"]');
  const coverBox = await coverFrame.boundingBox();

  expect(coverBox).not.toBeNull();
  expect(coverBox!.width).toBeGreaterThanOrEqual(298);
  expect(coverBox!.width).toBeLessThanOrEqual(302);
  expect(coverBox!.height).toBeGreaterThanOrEqual(223);
  expect(coverBox!.height).toBeLessThanOrEqual(227);
  await expect(backgroundImage).toHaveCount(1);
  await expect(backgroundImage).toHaveCSS("object-fit", "cover");
  await expect(backgroundImage).toHaveCSS("opacity", "0.3");
  await expect(coverImage).toHaveCSS("object-fit", "contain");
  await expect(coverImage).toHaveCSS("opacity", "1");
  await expect(coverImage).toHaveCSS("filter", "none");
  await expect(coverImage).toHaveCSS("z-index", "10");
  expect(browserErrors).toEqual([]);
});
