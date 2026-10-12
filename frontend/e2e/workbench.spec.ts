import { expect, test } from "@playwright/test";
import {
  summarizedItem,
  summarizedDetail,
  json,
  installApiMocks,
  watchBrowserErrors,
} from "./support";

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
