import { ApiClientError } from "./api";
import { getTextSourceType } from "./media";
import type {
  AsrEngine,
  AsrStatusResponse,
  DemoDetail,
  ParseResponse,
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
    tldr: "逐字稿已更新，可先对比版本，再生成结构化总结。",
    key_points: [
      `《${videoTitle}》的逐字稿已准备好。`,
      "总结与导图已重置，避免继续展示与当前逐字稿不一致的内容。",
      "确认逐字稿后，可手动生成新的摘录、导图和知识稿。"
    ],
    timeline: [],
    structured_analysis_markdown: `## ${videoTitle}\n### 当前状态\n逐字稿已更新，可以先检查内容是否准确。\n### 下一步\n确认转写效果后重新生成总结和导图。`,
    takeaways: [
      "确认逐字稿后，可以继续生成摘录、导图和问答。",
      "专有名词、人名和断句仍建议结合原媒体复核。"
    ],
    to_confirm: ["逐字稿中的关键摘录需要结合原媒体复核。"]
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
    const existingEngine = baseDetail.transcript.asr_meta.engine.toLowerCase();
    const existingKey = existingEngine.includes("sensevoice")
      ? "sensevoice_small"
      : "local_whisper";
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

export function getRecommendedLocalAsrEngine(
  status: AsrStatusResponse | null
): AsrEngine {
  if (
    status?.recommended_engine === "sensevoice_small" &&
    status.sensevoice_available
  ) {
    return "sensevoice_small";
  }
  return "local_whisper";
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
