import { createWriteStream, existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const DOUYIN_DETAIL_PATH = "/aweme/v1/web/aweme/detail/";
const PAGE_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 15_000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MEDIA_MAX_BYTES = 1024 * 1024 * 1024;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRequire = createRequire(join(scriptDirectory, "../frontend/package.json"));
const { chromium } = frontendRequire("playwright");
// 使用独立于用户日常浏览器资料的 Edge profile。抖音会给新会话分配状态，
// 每次都从 Playwright 临时 profile 启动会显著增加详情接口偶发缺失的概率。
const browserProfileDirectory = process.env.DOUYIN_BROWSER_PROFILE_DIR?.trim()
  || join(scriptDirectory, "../../private/douyin-edge-profile");

function resolveBrowserExecutable() {
  const configuredPath = process.env.DOUYIN_BROWSER_EXECUTABLE?.trim();
  const candidates = [
    configuredPath,
    join(process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.PROGRAMFILES ?? "C:/Program Files", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.PROGRAMFILES ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

function parseArguments() {
  const [firstArgument, secondArgument, thirdArgument] = process.argv.slice(2);
  if (firstArgument === "--download-media") {
    return {
      mediaTargetPath: secondArgument?.trim(),
      sourceUrl: thirdArgument?.trim()
    };
  }

  return { mediaTargetPath: undefined, sourceUrl: firstArgument?.trim() };
}

function getMediaUrl(item) {
  const candidates = [
    ...(item.video?.play_addr?.url_list ?? []),
    ...(item.video?.download_addr?.url_list ?? [])
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
}

async function downloadMedia(page, item, targetPath) {
  const mediaUrl = getMediaUrl(item);
  if (!mediaUrl) {
    throw new Error("抖音详情接口没有返回可下载的视频流。");
  }

  const [userAgent, cookies] = await Promise.all([
    page.evaluate(() => navigator.userAgent),
    page.context().cookies(mediaUrl)
  ]);
  const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const response = await fetch(mediaUrl, {
    headers: {
      Accept: "*/*",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Referer: page.url(),
      "User-Agent": userAgent
    },
    signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS)
  });
  if (!response.ok || !response.body) {
    throw new Error(`抖音媒体流返回 ${response.status}。`);
  }

  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MEDIA_MAX_BYTES) {
    throw new Error("抖音视频文件超过本地转写支持的大小限制。");
  }

  let downloadedBytes = 0;
  const sizeLimit = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MEDIA_MAX_BYTES) {
        callback(new Error("抖音视频文件超过本地转写支持的大小限制。"));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      sizeLimit,
      createWriteStream(targetPath, { flags: "w" })
    );
  } catch (error) {
    await fs.unlink(targetPath).catch(() => undefined);
    throw error;
  }
}

async function main() {
  const { mediaTargetPath, sourceUrl } = parseArguments();
  if (!sourceUrl) {
    throw new Error("缺少抖音公开视频链接。");
  }
  if (mediaTargetPath === "") {
    throw new Error("缺少媒体文件保存路径。");
  }

  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("未找到本机 Edge 或 Chrome。可通过 DOUYIN_BROWSER_EXECUTABLE 配置浏览器路径。");
  }

  await fs.mkdir(browserProfileDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(browserProfileDirectory, {
    executablePath,
    headless: true
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    const detailResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes(DOUYIN_DETAIL_PATH),
      { timeout: DETAIL_TIMEOUT_MS }
    );

    await page.goto(sourceUrl, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: "domcontentloaded"
    });
    const detailResponse = await detailResponsePromise;
    if (!detailResponse.ok()) {
      throw new Error(`抖音详情接口返回 ${detailResponse.status()}。`);
    }

    const payload = await detailResponse.json();
    if (!payload || typeof payload !== "object" || !payload.aweme_detail) {
      throw new Error("抖音详情接口没有返回视频数据。");
    }

    if (mediaTargetPath) {
      await downloadMedia(page, payload.aweme_detail, mediaTargetPath);
      process.stdout.write(JSON.stringify({ media_path: mediaTargetPath }));
      return;
    }

    process.stdout.write(JSON.stringify(payload.aweme_detail));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "抖音浏览器后备解析失败。";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
