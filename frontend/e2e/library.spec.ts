import { expect, test } from "@playwright/test";
import {
  installApiMocks,
  watchBrowserErrors,
  getRenderedTextCenter,
} from "./support";

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
