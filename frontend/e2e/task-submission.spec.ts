import { expect, test } from "@playwright/test";
import {
  summarizedItem,
  needsTranscriptItem,
  needsTranscriptDetail,
  transcribedNeedsTranscriptDetail,
  json,
  installApiMocks,
  watchBrowserErrors,
} from "./support";

test("单条失败后从任务页重试，正在阅读的详情继续同步最新结果", async ({ page }) => {
  const browserErrors = watchBrowserErrors(page);
  let submitted = false;
  let phase = "failed";
  const batchId = "retry-single-batch";
  const taskId = "retry-single-task";
  const snapshot = () => ({
    batch_id: batchId, client_request_id: "retry-single-request",
    created_at: "2026-10-12T08:00:00Z", success: true,
    items: [{
      cancelled: false, input_index: 0, result_available: true,
      source_url: needsTranscriptItem.source_url, video_id: needsTranscriptItem.video_id,
      task_id: taskId, title: needsTranscriptItem.title, status: phase,
      stage: phase === "succeeded" ? "done" : "recognize",
      updated_at: `2026-10-12T08:00:0${phase === "failed" ? 1 : phase === "running" ? 2 : 3}Z`
    }],
    stats: { active: phase === "running" ? 1 : 0, cancelled: 0,
      failed: phase === "failed" ? 1 : 0, succeeded: phase === "succeeded" ? 1 : 0, total: 1 }
  });
  await installApiMocks(page);
  await page.route("http://127.0.0.1:8000/api/task-batches**", (route) => {
    if (route.request().method() === "POST") {
      submitted = true;
      return json(route, snapshot());
    }
    if (new URL(route.request().url()).pathname.endsWith(batchId)) return json(route, snapshot());
    return json(route, {
      success: true, active_task_count: phase === "running" ? 1 : 0,
      active_video_ids: phase === "running" ? [needsTranscriptItem.video_id] : [],
      batches: submitted ? [{ batch_id: batchId, created_at: snapshot().created_at, stats: snapshot().stats }] : []
    });
  });
  await page.route(`http://127.0.0.1:8000/api/tasks/${taskId}/retry`, (route) => {
    phase = "running";
    return json(route, { success: true, task: snapshot().items[0] });
  });
  await page.route(`http://127.0.0.1:8000/api/library/${needsTranscriptItem.video_id}`, (route) =>
    json(route, phase === "succeeded" ? {
      ...transcribedNeedsTranscriptDetail, library_summary_status: "ai_generated",
      summary: { ...needsTranscriptDetail.summary, tldr: "重试生成的最新总结" }
    } : needsTranscriptDetail)
  );
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "公开媒体链接" });
  await input.fill(needsTranscriptItem.source_url);
  await page.getByRole("button", { name: "提炼内容", exact: true }).click();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "重试任务", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消任务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("heading", { name: needsTranscriptItem.title, exact: true })).toBeVisible();
  phase = "succeeded";
  await expect(page.getByText("重试生成的最新总结", { exact: true })).toBeVisible({ timeout: 10_000 });
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
