import { expect, test } from "@playwright/test";
import {
  json,
  installApiMocks,
  watchBrowserErrors,
} from "./support";

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
