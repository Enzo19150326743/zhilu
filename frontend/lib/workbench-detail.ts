import { ApiClientError } from "./api";
import { getTextSourceType } from "./media";
import type {
  DemoDetail,
  ParseResponse,
  ProcessingTaskItem,
  SummarizeResponse,
  SummaryGenerationMeta,
  TranscriptPayload,
  VideoSummary
} from "./types";

export function isParseResponse(
  detail: DemoDetail | ParseResponse
): detail is ParseResponse {
  return "source_url" in detail;
}

export function getLatestTaskForDetail(
  detail: DemoDetail | ParseResponse | null,
  tasks: (ProcessingTaskItem | null)[]
): ProcessingTaskItem | null {
  if (!detail) return null;
  const activeStatuses = new Set(["queued", "running", "waiting_retry"]);
  return tasks.reduce<ProcessingTaskItem | null>((latest, task) => {
    if (!task || !(
      task.video_id === detail.video.video_id ||
      (isParseResponse(detail) && task.source_url === detail.source_url)
    )) return latest;
    if (!latest) return task;
    const time = Date.parse(task.updated_at) || 0;
    const latestTime = Date.parse(latest.updated_at) || 0;
    if (time > latestTime) return task;
    // 同毫秒内重试可能沿用时间戳，活跃快照优先于已停止轮询的旧终态。
    return time === latestTime && activeStatuses.has(task.status) && !activeStatuses.has(latest.status)
      ? task : latest;
  }, null);
}

export function shouldAutoSummarizeDetail(
  detail: DemoDetail | ParseResponse
): boolean {
  if (!isParseResponse(detail) || detail.is_placeholder) {
    return false;
  }

  const hasTranscriptText = Boolean(
    detail.video.has_transcript && detail.transcript?.plain_text.trim()
  );

  return (
    hasTranscriptText &&
    getTextSourceType(detail.video) !== "shownotes" &&
    detail.library_summary_status !== "ai_generated"
  );
}

function getSummaryMetaFromStatus(
  summaryStatus: string | null | undefined,
  summaryModel: string | null | undefined
): SummaryGenerationMeta | null {
  if (summaryStatus === "ai_generated") {
    return {
      isAiGenerated: true,
      model: summaryModel ?? "历史记录"
    };
  }

  if (summaryStatus === "local_fallback") {
    return {
      isAiGenerated: false,
      model: summaryModel ?? "local-fallback"
    };
  }

  return null;
}

export function getSummaryMetaFromDetail(
  detail: ParseResponse
): SummaryGenerationMeta | null {
  const hasFullTranscript = Boolean(
    detail.video.has_transcript &&
      detail.transcript.plain_text.trim() &&
      getTextSourceType(detail.video) !== "shownotes"
  );

  if (!hasFullTranscript) {
    return null;
  }

  return getSummaryMetaFromStatus(
    detail.library_summary_status,
    detail.library_summary_model
  );
}

function buildAsrSummaryPlaceholder(
  videoTitle: string,
  mediaType: string | null | undefined
): VideoSummary {
  const contentType = mediaType === "podcast" ? "播客" : "视频";

  return {
    content_type: contentType,
    topics: ["选题"],
    tldr: "逐字稿已生成，正在继续提炼内容。",
    key_points: [
      `《${videoTitle}》的逐字稿已准备好。`,
      "结构化总结和导图正在生成，完成后自动更新。"
    ],
    timeline: [],
    structured_analysis_markdown: `## ${videoTitle}\n### 当前状态\n逐字稿已生成，正在基于完整内容生成总结和导图。`,
    takeaways: [],
    to_confirm: []
  };
}

function buildAsrMindmapPlaceholder(videoTitle: string): string {
  return `# ${videoTitle}\n## 当前状态\n### 逐字稿已生成\n### 正在生成总结和导图\n## 下一步\n### 等待结构化结果写回`;
}

export function buildTranscribedDetail(
  baseDetail: ParseResponse,
  transcript: TranscriptPayload,
  transcriptVariantKey: string
): ParseResponse {
  const updatedVideo = {
    ...baseDetail.video,
    has_transcript: true,
    media_type: baseDetail.video.media_type ?? "video",
    text_source_type: "asr_transcript"
  };
  const updatedTitle = updatedVideo.title || "未命名内容";
  const existingVariants = { ...(baseDetail.transcript_variants ?? {}) };
  if (
    Object.keys(existingVariants).length === 0 &&
    baseDetail.video.text_source_type === "asr_transcript" &&
    baseDetail.transcript.asr_meta
  ) {
    const existingKey = baseDetail.active_transcript_variant ?? baseDetail.transcript.asr_meta.engine;
    existingVariants[existingKey] = baseDetail.transcript;
  }
  existingVariants[transcriptVariantKey] = transcript;

  return {
    ...baseDetail,
    library_summary_model: null,
    library_summary_status: "none",
    mindmap_markdown: buildAsrMindmapPlaceholder(updatedTitle),
    mindmap_meta: null,
    summary: buildAsrSummaryPlaceholder(updatedTitle, updatedVideo.media_type),
    transcript,
    transcript_variants: existingVariants,
    active_transcript_variant: transcriptVariantKey,
    video: updatedVideo
  };
}

export function isRecoverableTranscribeError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.errorCode === "REQUEST_INTERRUPTED" || error.errorCode === "TIMEOUT")
  );
}

export function getSummaryTaskMessage(response: SummarizeResponse): string {
  if (response.is_ai_generated) {
    return "已生成结构化总结。";
  }

  if (response.model === "local-fallback") {
    return "AI 总结服务未连接，已生成基础摘要。";
  }

  const fallbackReason = response.fallback_reason ?? "";
  if (fallbackReason.includes("JSONDecodeError")) {
    return "AI 总结返回格式异常，已生成基础摘要。可稍后重新生成一次。";
  }

  return fallbackReason
    ? "AI 总结暂时未成功，已生成基础摘要。"
    : "AI 总结未成功，已生成基础摘要。";
}
