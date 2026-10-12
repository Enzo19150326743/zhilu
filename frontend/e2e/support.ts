import type { Locator, Page, Route } from "@playwright/test";

export const verticalThumbnail = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#d6c7a1"/></svg>'
)}`;

export const summarizedItem = {
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

export const needsTranscriptItem = {
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

export const emptySummary = {
  key_points: [],
  structured_analysis_markdown: "",
  takeaways: [],
  timeline: [],
  tldr: "不应展示的旧总结",
  to_confirm: []
};

export const needsTranscriptDetail = {
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

export const generatedTranscript = {
  asr_meta: { correction_status: "corrected", engine: "sensevoice" },
  plain_text: "这是刚刚生成的完整转写稿。",
  segments: [{ start: 0, text: "这是刚刚生成的完整转写稿。" }]
};

export const transcribedNeedsTranscriptDetail = {
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

export const processedNeedsTranscriptItem = {
  ...needsTranscriptItem,
  has_transcript: true,
  summary_status: "ai_generated",
  text_source_type: "asr_transcript"
};

export const summarizedDetail = {
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

export const correctionLibrary = {
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

export function json(route: Route, body: unknown) {
  return route.fulfill({
    body: JSON.stringify(body),
    headers: {
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "content-type": "application/json"
    },
    status: 200
  });
}

export async function installApiMocks(page: Page, libraryDelayMs = 0) {
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

export function watchBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export async function getRenderedTextCenter(locator: Locator) {
  return locator.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    return box.x + box.width / 2;
  });
}
