"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AiTabs } from "@/components/AiTabs";
import { FormatSelector } from "@/components/FormatSelector";
import { Header } from "@/components/Header";
import { LandingHero } from "@/components/LandingHero";
import { RecentLibrary } from "@/components/RecentLibrary";
import { TranscribeSettingsDialog } from "@/components/TranscribeSettingsDialog";
import { TranscribeTaskToasts } from "@/components/TranscribeTaskToasts";
import { UrlInput } from "@/components/UrlInput";
import { VideoPreviewCard } from "@/components/VideoPreviewCard";
import { ApiClientError, apiClient } from "@/lib/api";
import { getMediaType, getTextSourceType } from "@/lib/media";
import { mockDemoDetails, mockDemos } from "@/lib/mock-data";
import {
  getDefaultTranscribeSettings,
  normalizeTranscribeSettings
} from "@/lib/transcribe-settings";
import { pollForRecoveredValue } from "@/lib/transcribe-recovery";
import type {
  AsrEngine,
  AsrStatusResponse,
  AppStatus,
  DemoDetail,
  DemoItem,
  LibraryFilter,
  LibraryItem,
  LibraryStatsResponse,
  NoteDraft,
  ParseTask,
  ParseResponse,
  SummaryDisplayState,
  SummarizeResponse,
  SummaryTask,
  SummaryGenerationMeta,
  TranscribeContextSettings,
  TranscribeTask,
  TranscriptPayload,
  VideoSummary
} from "@/lib/types";

type TabKey = "summary" | "mindmap" | "qa" | "transcript";
const INITIAL_LIBRARY_LIMIT = 8;
const LIBRARY_LIMIT_STEP = 8;
const MAX_LIBRARY_LIMIT = 50;
const TRANSCRIBE_RECOVERY_INTERVAL_MS = 5000;
const TRANSCRIBE_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;

function isParseResponse(
  detail: DemoDetail | ParseResponse
): detail is ParseResponse {
  return "source_url" in detail;
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

function buildAsrSummaryPlaceholder(
  videoTitle: string,
  mediaType: string | null | undefined
): VideoSummary {
  const contentType = mediaType === "podcast" ? "播客" : "视频";

  return {
    content_type: contentType,
    topics: ["选题"],
    tldr: "逐字稿已生成，正在继续生成结构化总结。",
    key_points: [
      `《${videoTitle}》的逐字稿已准备好。`,
      "总结与导图已重置，系统会基于新逐字稿继续处理。",
      "结构化总结完成后，摘录、导图和知识稿会同步更新。"
    ],
    timeline: [],
    structured_analysis_markdown: `## ${videoTitle}\n### 当前状态\n逐字稿已生成，正在继续生成总结和导图。\n### 下一步\n等待结构化结果写回。`,
    takeaways: [
      "总结完成后，可以继续查看摘录、导图和问答。",
      "专有名词、人名和断句仍建议结合原媒体复核。"
    ],
    to_confirm: ["逐字稿中的关键摘录需要结合原媒体复核。"]
  };
}

function buildAsrMindmapPlaceholder(videoTitle: string): string {
  return `# ${videoTitle}\n## 当前状态\n### 逐字稿已生成\n### 正在生成总结和导图\n## 下一步\n### 等待结构化结果写回`;
}

function buildTranscribedDetail(
  baseDetail: ParseResponse,
  transcript: TranscriptPayload
): ParseResponse {
  const updatedVideo = {
    ...baseDetail.video,
    has_transcript: true,
    media_type: baseDetail.video.media_type ?? "video",
    text_source_type: "asr_transcript"
  };
  const updatedTitle = updatedVideo.title || "未命名内容";

  return {
    ...baseDetail,
    library_summary_model: null,
    library_summary_status: "none",
    mindmap_markdown: buildAsrMindmapPlaceholder(updatedTitle),
    mindmap_meta: null,
    summary: buildAsrSummaryPlaceholder(updatedTitle, updatedVideo.media_type),
    transcript,
    video: updatedVideo
  };
}

function isRecoverableTranscribeError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.errorCode === "REQUEST_INTERRUPTED" || error.errorCode === "TIMEOUT")
  );
}

function getSummaryTaskMessage(response: SummarizeResponse): string {
  if (response.is_cached) {
    return "该内容已生成过总结，已直接返回历史结果。";
  }

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

export default function HomePage() {
  const [demos, setDemos] = useState<DemoItem[]>(mockDemos);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStatsResponse | null>(
    null
  );
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryLimit, setLibraryLimit] = useState(INITIAL_LIBRARY_LIMIT);
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);
  const [loadingDemoId, setLoadingDemoId] = useState<string | null>(null);
  const [loadingLibraryVideoId, setLoadingLibraryVideoId] = useState<string | null>(
    null
  );
  const [deletingLibraryVideoId, setDeletingLibraryVideoId] = useState<
    string | null
  >(null);
  const [isRefreshingLibrary, setIsRefreshingLibrary] = useState(false);
  const [isClearingLibrary, setIsClearingLibrary] = useState(false);
  const [copiedLibraryVideoId, setCopiedLibraryVideoId] = useState<string | null>(
    null
  );
  const [detail, setDetail] = useState<DemoDetail | ParseResponse | null>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summaryErrorMessage, setSummaryErrorMessage] = useState<string | null>(
    null
  );
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null);
  const [parseTasks, setParseTasks] = useState<ParseTask[]>([]);
  const [summaryTasks, setSummaryTasks] = useState<SummaryTask[]>([]);
  const [transcribeTasks, setTranscribeTasks] = useState<TranscribeTask[]>([]);
  const [isTranscribeSettingsOpen, setIsTranscribeSettingsOpen] = useState(false);
  const [asrStatus, setAsrStatus] = useState<AsrStatusResponse | null>(null);
  const [pendingAsrEngine, setPendingAsrEngine] =
    useState<AsrEngine>("local_whisper");
  const [pendingTranscribeSettings, setPendingTranscribeSettings] =
    useState<TranscribeContextSettings>(() => getDefaultTranscribeSettings(null));
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const [summaryGenerationMeta, setSummaryGenerationMeta] =
    useState<SummaryGenerationMeta | null>(null);
  const activeSourceUrlRef = useRef<string | null>(null);
  const inputUrlRef = useRef("");

  const refreshLibraryItems = async (
    showRefreshState = false,
    limit = libraryLimit
  ) => {
    if (showRefreshState) {
      setIsRefreshingLibrary(true);
      setErrorMessage(null);
    }

    try {
      const [listResponse, statsResponse] = await Promise.all([
        apiClient.getRecentLibraryItems(limit),
        apiClient.getLibraryStats()
      ]);
      setLibraryItems(listResponse.items);
      setLibraryStats(statsResponse);
    } catch {
      if (showRefreshState) {
        setErrorMessage("最近解析刷新失败，请确认后端服务已启动。");
      } else {
        setLibraryItems([]);
        setLibraryStats(null);
      }
    } finally {
      if (showRefreshState) {
        setIsRefreshingLibrary(false);
      }
    }
  };

  useEffect(() => {
    apiClient
      .getDemos()
      .then((response) => setDemos(response.demos))
      .catch(() => setDemos(mockDemos));

    apiClient
      .getAsrStatus()
      .then(setAsrStatus)
      .catch(() => setAsrStatus(null));

    void refreshLibraryItems(false, INITIAL_LIBRARY_LIMIT);
  }, []);

  const activeDetail =
    detail && (status === "parsed" || status === "loading") ? detail : null;
  const activeLibraryVideoId =
    activeDetail && isParseResponse(activeDetail)
      ? activeDetail.video.video_id
      : null;
  const activeSourceUrl =
    activeDetail && isParseResponse(activeDetail) ? activeDetail.source_url : null;
  const trimmedInputUrl = url.trim();
  const runningParseTaskCount = parseTasks.filter(
    (task) => task.status === "running"
  ).length;
  const isParsing = Boolean(
    trimmedInputUrl &&
      parseTasks.some(
        (task) => task.sourceUrl === trimmedInputUrl && task.status === "running"
      )
  );
  const runningTranscribeTaskCount = transcribeTasks.filter(
    (task) => task.status === "running"
  ).length;
  const runningSummaryTaskCount = summaryTasks.filter(
    (task) => task.status === "running"
  ).length;
  const activeSummaryTask = activeSourceUrl
    ? (summaryTasks.find((task) => task.sourceUrl === activeSourceUrl) ?? null)
    : null;
  const activeTranscribeTask = activeSourceUrl
    ? (transcribeTasks.find((task) => task.sourceUrl === activeSourceUrl) ?? null)
    : null;
  const isCurrentDetailSummarizing = Boolean(
    activeSummaryTask?.status === "running"
  );
  const isCurrentDetailTranscribing = Boolean(
    activeTranscribeTask?.status === "running"
  );
  const activeSummaryErrorMessage =
    activeSummaryTask?.status === "error"
      ? (activeSummaryTask.errorMessage ?? null)
      : summaryErrorMessage;
  const activeTranscribeErrorMessage =
    activeTranscribeTask?.status === "error"
      ? (activeTranscribeTask.errorMessage ?? null)
    : null;
  const isParsePlaceholder =
    detail && "is_placeholder" in detail ? detail.is_placeholder : false;
  const hasUsableContentText = Boolean(
    activeDetail?.video.has_transcript &&
      activeDetail?.transcript?.plain_text.trim()
  );
  const activeTextSourceType = activeDetail?.video
    ? getTextSourceType(activeDetail.video)
    : null;
  const canUpgradeShownotesToTranscript = activeTextSourceType === "shownotes";
  const hasFullTranscript = hasUsableContentText && !canUpgradeShownotesToTranscript;
  const canSummarize = hasFullTranscript;
  const canTranscribe = Boolean(
    activeDetail &&
      isParseResponse(activeDetail) &&
      !activeDetail.is_placeholder &&
      (!hasUsableContentText || canUpgradeShownotesToTranscript) &&
      !isCurrentDetailSummarizing &&
      !isCurrentDetailTranscribing
  );
  const summaryDisplayState: SummaryDisplayState = !activeDetail
    ? "empty"
    : isParseResponse(activeDetail)
      ? summaryGenerationMeta && !canUpgradeShownotesToTranscript
        ? "generated"
        : "empty"
      : "demo";
  const canLoadMoreLibraryItems =
    (libraryStats?.total_items ?? libraryItems.length) > libraryItems.length &&
    libraryLimit < MAX_LIBRARY_LIMIT;

  useEffect(() => {
    activeSourceUrlRef.current = activeSourceUrl;
  }, [activeSourceUrl]);

  useEffect(() => {
    inputUrlRef.current = url;
  }, [url]);

  const workspaceHint = useMemo(() => {
    if (status === "idle") {
      return "打开一份推荐内容，或粘贴真实公开媒体链接。";
    }

    if (status === "loading") {
      return loadingLibraryVideoId
        ? "正在打开本地历史记录。"
        : "正在加载推荐内容。";
    }

    if (status === "error") {
      return "当前操作未完成，请查看上方提示。";
    }

    if (activeDemoId) {
      return "推荐内容已载入，可切换右侧工作区查看结构化结果。";
    }

    if (isParsePlaceholder) {
      return "解析结果已载入，后续将逐步替换为真实内容文本和总结。";
    }

    if (isCurrentDetailTranscribing) {
      return "当前链接正在后台生成转写稿，可以切到其他链接继续操作。";
    }

    if (isCurrentDetailSummarizing) {
      return "当前链接正在后台生成结构化总结，可以切到其他链接继续操作。";
    }

    if (runningTranscribeTaskCount > 0) {
      return `后台还有 ${runningTranscribeTaskCount} 个转写任务在处理，当前页面可以继续操作。`;
    }

    if (runningParseTaskCount > 0) {
      return `后台还有 ${runningParseTaskCount} 个解析任务在处理，当前页面可以继续操作。`;
    }

    if (runningSummaryTaskCount > 0) {
      return `后台还有 ${runningSummaryTaskCount} 个总结任务在处理，当前页面可以继续操作。`;
    }

    return canSummarize
      ? "元数据和完整逐字稿已就绪，将继续生成总结和导图。"
      : canUpgradeShownotesToTranscript
        ? "当前只有 shownotes 原文，请先生成转写稿，随后会继续生成总结和导图。"
      : "元数据已解析，但当前没有可用内容文本，可先生成转写稿。";
  }, [
    activeDemoId,
    canSummarize,
    canUpgradeShownotesToTranscript,
    isCurrentDetailTranscribing,
    isCurrentDetailSummarizing,
    isParsePlaceholder,
    loadingLibraryVideoId,
    runningParseTaskCount,
    runningTranscribeTaskCount,
    runningSummaryTaskCount,
    status
  ]);

  const handleAnalyze = async (forceRefresh = false) => {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setStatus(detail ? "parsed" : "error");
      setErrorMessage("请输入有效的媒体链接，或直接打开一份推荐内容。");
      return;
    }

    const runningSameUrlTask = parseTasks.some(
      (task) => task.sourceUrl === trimmedUrl && task.status === "running"
    );
    if (runningSameUrlTask) {
      setSummaryNotice("该链接已经在后台解析，请等待当前任务完成。");
      return;
    }

    const taskId = `${Date.now()}-parse`;
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryNotice(null);
    setSummaryGenerationMeta(null);
    setLoadingDemoId(null);
    setParseTasks((currentTasks) => [
      {
        id: taskId,
        kind: "parse",
        sourceUrl: trimmedUrl,
        title: forceRefresh ? `重新解析：${trimmedUrl}` : trimmedUrl,
        status: "running",
        startedAt: Date.now()
      },
      ...currentTasks.filter((task) => task.sourceUrl !== trimmedUrl)
    ]);

    try {
      const response = await apiClient.parseVideo(trimmedUrl, forceRefresh);
      const shouldAutoSummarize = shouldAutoSummarizeDetail(response);
      const taskMessage = shouldAutoSummarize
        ? response.is_from_cache
          ? "已打开本地历史逐字稿，正在继续生成总结。"
          : "完整逐字稿已解析，正在继续生成总结。"
        : response.is_from_cache
          ? "已从本地历史缓存打开解析结果。"
          : "媒体元数据已解析并写入最近解析。";

      setParseTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                finishedAt: Date.now(),
                message: taskMessage,
                status: "success",
                title: response.video.title || task.title
              }
            : task
        )
      );

      setDetail((currentDetail) => {
        const currentInputUrl = inputUrlRef.current.trim();
        const shouldOpenResult =
          currentInputUrl === trimmedUrl ||
          (currentDetail
            ? isParseResponse(currentDetail)
              ? currentDetail.source_url === trimmedUrl
              : currentDetail.video.url === trimmedUrl
            : false);

        return shouldOpenResult ? response : currentDetail;
      });
      if (
        inputUrlRef.current.trim() === trimmedUrl ||
        activeSourceUrlRef.current === trimmedUrl
      ) {
        setActiveDemoId(null);
        setUrl(response.source_url);
        setSummaryGenerationMeta(
          getSummaryMetaFromStatus(
            response.library_summary_status,
            response.library_summary_model
          )
        );
        setActiveTab("summary");
        setStatus("parsed");
        window.scrollTo({ behavior: "auto", left: 0, top: 0 });
      }
      void refreshLibraryItems();
      if (shouldAutoSummarize) {
        void runSummaryForDetail(response);
      }
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "解析失败，请稍后重试。";
      setParseTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                errorMessage: errorText,
                finishedAt: Date.now(),
                status: "error"
              }
            : task
        )
      );
      if (inputUrlRef.current.trim() === trimmedUrl) {
        setStatus(activeSourceUrlRef.current ? "parsed" : "error");
        setErrorMessage(errorText);
      }
    }
  };

  const handleLoadDemo = async (demoId: string) => {
    setStatus("loading");
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryNotice(null);
    setSummaryGenerationMeta(null);
    setLoadingDemoId(demoId);
    setLoadingLibraryVideoId(null);
    setActiveDemoId(demoId);

    try {
      const response = await apiClient.getDemoDetail(demoId);
      setDetail(response);
    } catch {
      setDetail(mockDemoDetails[demoId] ?? mockDemoDetails.ai_talk_001);
    } finally {
      setStatus("parsed");
      setActiveTab("summary");
      setLoadingDemoId(null);
      window.scrollTo({ behavior: "auto", left: 0, top: 0 });
    }
  };

  const handleGoHome = () => {
    setDetail(null);
    setActiveDemoId(null);
    setLoadingDemoId(null);
    setLoadingLibraryVideoId(null);
    setDeletingLibraryVideoId(null);
    setIsRefreshingLibrary(false);
    setIsClearingLibrary(false);
    setCopiedLibraryVideoId(null);
    setUrl("");
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryNotice(null);
    setSummaryGenerationMeta(null);
    setActiveTab("summary");
    setStatus("idle");
    window.scrollTo({ behavior: "auto", left: 0, top: 0 });
  };

  const getSummaryMetaFromLibraryItem = (
    item: LibraryItem
  ): SummaryGenerationMeta | null => {
    return getSummaryMetaFromStatus(item.summary_status, item.summary_model);
  };

  const handleOpenLibraryItem = async (item: LibraryItem) => {
    setStatus("loading");
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryNotice(null);
    setLoadingDemoId(null);
    setLoadingLibraryVideoId(item.video_id);
    setDeletingLibraryVideoId(null);
    setActiveDemoId(null);

    try {
      const response = await apiClient.getLibraryDetail(item.video_id);
      setDetail(response);
      setUrl(response.source_url);
      setSummaryGenerationMeta(getSummaryMetaFromLibraryItem(item));
      setActiveTab("summary");
      setStatus("parsed");
      window.scrollTo({ behavior: "auto", left: 0, top: 0 });
    } catch (error) {
      setStatus(detail ? "parsed" : "error");
      setErrorMessage(
        error instanceof Error ? error.message : "历史记录打开失败，请稍后重试。"
      );
    } finally {
      setLoadingLibraryVideoId(null);
    }
  };

  const handleDeleteLibraryItem = async (item: LibraryItem) => {
    const shouldDelete = window.confirm(
      `确定从最近解析中删除《${item.title}》吗？此操作只删除本地历史记录。`
    );
    if (!shouldDelete) {
      return;
    }

    const isDeletingActiveItem = activeLibraryVideoId === item.video_id;
    setDeletingLibraryVideoId(item.video_id);
    setErrorMessage(null);

    try {
      await apiClient.deleteLibraryItem(item.video_id);
      setLibraryItems((currentItems) =>
        currentItems.filter(
          (currentItem) => currentItem.video_id !== item.video_id
        )
      );
      if (copiedLibraryVideoId === item.video_id) {
        setCopiedLibraryVideoId(null);
      }
      void refreshLibraryItems(false, libraryLimit);
      if (isDeletingActiveItem) {
        handleGoHome();
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "历史记录删除失败，请稍后重试。"
      );
    } finally {
      setDeletingLibraryVideoId(null);
    }
  };

  const handleRefreshLibraryItems = () => {
    void refreshLibraryItems(true);
  };

  const handleLoadMoreLibraryItems = () => {
    const nextLimit = Math.min(
      libraryLimit + LIBRARY_LIMIT_STEP,
      MAX_LIBRARY_LIMIT
    );
    setLibraryLimit(nextLimit);
    void refreshLibraryItems(true, nextLimit);
  };

  const handleCopyLibrarySourceUrl = async (item: LibraryItem) => {
    try {
      await navigator.clipboard.writeText(item.source_url);
      setCopiedLibraryVideoId(item.video_id);
      window.setTimeout(() => {
        setCopiedLibraryVideoId((currentVideoId) =>
          currentVideoId === item.video_id ? null : currentVideoId
        );
      }, 1600);
    } catch {
      setErrorMessage("源链接复制失败，请手动打开历史记录后复制。");
    }
  };

  const handleClearLibraryItems = async () => {
    const shouldClear = window.confirm(
      "确定清空全部本地历史记录吗？此操作不会删除推荐内容，也不会影响媒体源。"
    );
    if (!shouldClear) {
      return;
    }

    const shouldReturnHome = activeLibraryVideoId !== null;
    setIsClearingLibrary(true);
    setErrorMessage(null);

    try {
      await apiClient.clearLibraryItems();
      setLibraryItems([]);
      setLibraryStats({
        ai_summary_count: 0,
        fallback_summary_count: 0,
        no_transcript_count: 0,
        success: true,
        summarized_count: 0,
        total_items: 0,
        with_transcript_count: 0
      });
      setLibraryFilter("all");
      setCopiedLibraryVideoId(null);
      if (shouldReturnHome) {
        handleGoHome();
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "本地历史清空失败，请稍后重试。"
      );
    } finally {
      setIsClearingLibrary(false);
    }
  };

  const handleSummarize = async () => {
    if (!activeDetail) {
      setSummaryErrorMessage("当前没有可用于总结的内容文本。");
      return;
    }

    await runSummaryForDetail(activeDetail);
  };

  const waitForRecoveredTranscribeDetail = async (
    videoId: string,
    sourceUrl: string
  ): Promise<ParseResponse | null> =>
    pollForRecoveredValue({
      fetchValue: () => apiClient.getLibraryDetail(videoId),
      intervalMs: TRANSCRIBE_RECOVERY_INTERVAL_MS,
      isRecovered: (detail) =>
        Boolean(
          detail.source_url === sourceUrl &&
            getTextSourceType(detail.video) === "asr_transcript" &&
            detail.transcript?.plain_text.trim()
        ),
      timeoutMs: TRANSCRIBE_RECOVERY_TIMEOUT_MS
    });

  const applyTranscribeSuccess = (
    taskId: string,
    taskSourceUrl: string,
    updatedDetail: ParseResponse,
    successMessage: string
  ) => {
    setTranscribeTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              finishedAt: Date.now(),
              message: successMessage,
              status: "success"
            }
          : task
      )
    );

    setDetail((currentDetail) => {
      if (
        !currentDetail ||
        !isParseResponse(currentDetail) ||
        currentDetail.source_url !== taskSourceUrl
      ) {
        return currentDetail;
      }

      return updatedDetail;
    });

    if (activeSourceUrlRef.current === taskSourceUrl) {
      setSummaryGenerationMeta(null);
      setSummaryNotice(successMessage);
      setActiveTab("summary");
    }

    void refreshLibraryItems();
    void runSummaryForDetail(updatedDetail);
  };

  const handleTranscribeRequest = (settings?: TranscribeContextSettings) => {
    if (!activeDetail || !isParseResponse(activeDetail)) {
      setErrorMessage("当前记录无法生成转写稿，请先解析公开视频链接。");
      return;
    }

    if (
      transcribeTasks.some(
        (task) =>
          task.sourceUrl === activeDetail.source_url && task.status === "running"
      )
    ) {
      setSummaryNotice("该链接已经在后台生成转写稿，请等待当前任务完成。");
      return;
    }

    setPendingTranscribeSettings(
      normalizeTranscribeSettings(
        settings,
        getDefaultTranscribeSettings(activeDetail.video)
      )
    );
    // 云端识别只在用户明确选择时启用，每次打开弹窗都恢复隐私优先的本地默认值。
    setPendingAsrEngine("local_whisper");
    setIsTranscribeSettingsOpen(true);
  };

  const handleConfirmTranscribeSettings = () => {
    setIsTranscribeSettingsOpen(false);
    void startTranscribe(pendingTranscribeSettings, pendingAsrEngine);
  };

  const startTranscribe = async (
    settings?: TranscribeContextSettings,
    asrEngine: AsrEngine = "local_whisper"
  ) => {
    if (!activeDetail || !isParseResponse(activeDetail)) {
      setErrorMessage("当前记录无法生成转写稿，请先解析公开视频链接。");
      return;
    }

    const taskSourceUrl = activeDetail.source_url;
    const taskVideoId = activeDetail.video.video_id;
    const taskTitle = activeDetail.video.title || "未命名内容";

    if (
      transcribeTasks.some(
        (task) =>
          task.sourceUrl === taskSourceUrl && task.status === "running"
      )
    ) {
      setSummaryNotice("该链接已经在后台生成转写稿，请等待当前任务完成。");
      return;
    }

    const taskId = `${taskVideoId}-${Date.now()}`;
    setTranscribeTasks((currentTasks) => [
      {
        id: taskId,
        sourceUrl: taskSourceUrl,
        videoId: taskVideoId,
        title: taskTitle,
        status: "running",
        startedAt: Date.now(),
        asrEngine,
        contextSettings: settings
      },
      ...currentTasks.filter((task) => task.sourceUrl !== taskSourceUrl)
    ]);
    setSummaryErrorMessage(null);
    setSummaryNotice(null);

    try {
      const response = await apiClient.transcribeVideo({
        asr_engine: asrEngine,
        context_settings: settings ?? null,
        url: taskSourceUrl,
        video_id: taskVideoId
      });
      const successMessage = `${response.message} 正在继续生成总结。`;
      applyTranscribeSuccess(
        taskId,
        taskSourceUrl,
        buildTranscribedDetail(activeDetail, response.transcript),
        successMessage
      );
    } catch (error) {
      if (isRecoverableTranscribeError(error)) {
        setTranscribeTasks((currentTasks) =>
          currentTasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  message:
                    error instanceof ApiClientError &&
                    error.errorCode === "TIMEOUT"
                      ? "请求等待超时，后台仍在处理，正在同步结果。"
                      : "连接中断，后台可能仍在处理，正在同步结果。",
                  status: "running"
                }
              : task
          )
        );

        const recoveredDetail = await waitForRecoveredTranscribeDetail(
          taskVideoId,
          taskSourceUrl
        );
        if (recoveredDetail) {
          applyTranscribeSuccess(
            taskId,
            taskSourceUrl,
            recoveredDetail,
            "逐字稿已生成，已从本地历史恢复结果。"
          );
          return;
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : "转写稿生成失败，请稍后重试。";
      setTranscribeTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                errorMessage,
                finishedAt: Date.now(),
                status: "error"
              }
            : task
        )
      );
    }
  };

  const handleRetryTranscribeLocally = (taskId: string) => {
    const task = transcribeTasks.find((item) => item.id === taskId);
    if (
      !task ||
      task.asrEngine !== "fun_asr_flash" ||
      task.sourceUrl !== activeSourceUrl
    ) {
      return;
    }

    void startTranscribe(task.contextSettings, "local_whisper");
  };

  const handleSaveNoteDraft = async (
    sourceUrl: string,
    noteDraft: NoteDraft
  ): Promise<NoteDraft> => {
    const response = await apiClient.updateNoteDraft({
      highlights: noteDraft.highlights,
      source_url: sourceUrl
    });

    setDetail((currentDetail) => {
      if (
        !currentDetail ||
        !isParseResponse(currentDetail) ||
        currentDetail.source_url !== sourceUrl
      ) {
        return currentDetail;
      }

      return {
        ...currentDetail,
        note_draft: response.note_draft
      };
    });
    void refreshLibraryItems(false, libraryLimit);
    return response.note_draft;
  };

  const handleDismissWorkbenchTask = (taskId: string) => {
    setHiddenTaskIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(taskId);
      return nextIds;
    });
  };

  const shouldAutoSummarizeDetail = (
    summaryDetail: DemoDetail | ParseResponse
  ): boolean => {
    if (!isParseResponse(summaryDetail) || summaryDetail.is_placeholder) {
      return false;
    }

    const textSourceType = getTextSourceType(summaryDetail.video);
    const hasTranscriptText = Boolean(
      summaryDetail.video.has_transcript &&
        summaryDetail.transcript?.plain_text.trim()
    );

    return (
      hasTranscriptText &&
      textSourceType !== "shownotes" &&
      summaryDetail.library_summary_status !== "ai_generated"
    );
  };

  const isTaskSourceActive = (sourceUrl: string): boolean =>
    activeSourceUrlRef.current === sourceUrl ||
    inputUrlRef.current.trim() === sourceUrl;

  const runSummaryForDetail = async (
    summaryDetail: DemoDetail | ParseResponse
  ) => {
    const taskSourceUrl = isParseResponse(summaryDetail)
      ? summaryDetail.source_url
      : summaryDetail.video.url;

    if (!summaryDetail.transcript?.plain_text.trim()) {
      if (isTaskSourceActive(taskSourceUrl)) {
        setSummaryErrorMessage("当前没有可用于总结的内容文本。");
      }
      return;
    }

    if (getTextSourceType(summaryDetail.video) === "shownotes") {
      if (isTaskSourceActive(taskSourceUrl)) {
        setSummaryErrorMessage(
          "当前只有 shownotes 原文。请先生成转写稿，再基于完整逐字稿生成总结和导图。"
        );
      }
      return;
    }

    const taskVideoId = summaryDetail.video.video_id;
    const taskTitle = summaryDetail.video.title || "未命名内容";
    const taskTranscript = summaryDetail.transcript;
    const taskVideo = summaryDetail.video;

    if (
      summaryTasks.some(
        (task) => task.sourceUrl === taskSourceUrl && task.status === "running"
      )
    ) {
      if (isTaskSourceActive(taskSourceUrl)) {
        setSummaryNotice("该链接已经在后台生成总结，请等待当前任务完成。");
      }
      return;
    }

    const taskId = `${taskVideoId}-summary-${Date.now()}`;
    setSummaryTasks((currentTasks) => [
      {
        id: taskId,
        kind: "summary",
        sourceUrl: taskSourceUrl,
        videoId: taskVideoId,
        title: taskTitle,
        status: "running",
        startedAt: Date.now()
      },
      ...currentTasks.filter((task) => task.sourceUrl !== taskSourceUrl)
    ]);
    if (isTaskSourceActive(taskSourceUrl)) {
      setSummaryErrorMessage(null);
      setSummaryNotice(null);
    }

    try {
      const response = await apiClient.summarizeVideo({
        source_url: taskSourceUrl,
        transcript_plain_text: taskTranscript.plain_text,
        transcript_segments: taskTranscript.segments,
        video_author: taskVideo.author,
        video_title: taskVideo.title,
        media_type: getMediaType(taskVideo),
        text_source_type: getTextSourceType(taskVideo)
      });

      const taskMessage = getSummaryTaskMessage(response);

      setSummaryTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                finishedAt: Date.now(),
                message: taskMessage,
                status: "success"
              }
            : task
        )
      );

      setDetail((currentDetail) => {
        // NOTE: 总结请求可能在后台完成，必须按 source_url 回写，避免切换媒体后覆盖当前页面。
        if (
          !currentDetail ||
          (isParseResponse(currentDetail)
            ? currentDetail.source_url !== taskSourceUrl
            : currentDetail.video.url !== taskSourceUrl)
        ) {
          return currentDetail;
        }

        const nextDetail = {
          ...currentDetail,
          mindmap_markdown: response.mindmap_markdown,
          mindmap_meta: response.mindmap_meta ?? currentDetail.mindmap_meta ?? null,
          summary: response.summary
        };

        if (!isParseResponse(currentDetail)) {
          return nextDetail;
        }

        return {
          ...nextDetail,
          library_summary_model: response.model,
          library_summary_status: response.is_ai_generated
            ? "ai_generated"
            : "local_fallback"
        };
      });

      if (isTaskSourceActive(taskSourceUrl)) {
        setSummaryGenerationMeta({
          isAiGenerated: response.is_ai_generated,
          model: response.model
        });
        if (response.is_ai_generated || response.model === "local-fallback") {
          setSummaryNotice(taskMessage);
        } else {
          setSummaryErrorMessage(taskMessage);
        }
        setActiveTab("summary");
      }

      void refreshLibraryItems();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "总结生成失败，请稍后重试。";
      setSummaryTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                errorMessage,
                finishedAt: Date.now(),
                status: "error"
              }
            : task
        )
      );
      if (isTaskSourceActive(taskSourceUrl)) {
        setSummaryErrorMessage(errorMessage);
      }
    }
  };

  const visibleTasks = [...parseTasks, ...summaryTasks, ...transcribeTasks]
    .filter((task) => !hiddenTaskIds.has(task.id))
    .sort((leftTask, rightTask) => rightTask.startedAt - leftTask.startedAt);

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <Header onHomeClick={handleGoHome} />

      {!activeDetail ? (
        <>
          <LandingHero
            demos={demos}
            errorMessage={errorMessage}
            isParsing={isParsing}
            loadingDemoId={loadingDemoId}
            url={url}
            onAnalyze={handleAnalyze}
            onChangeUrl={setUrl}
            onLoadDemo={handleLoadDemo}
          />
          <RecentLibrary
            activeVideoId={activeLibraryVideoId}
            canLoadMore={canLoadMoreLibraryItems}
            copiedVideoId={copiedLibraryVideoId}
            deletingVideoId={deletingLibraryVideoId}
            disabled={loadingDemoId !== null}
            filter={libraryFilter}
            isClearing={isClearingLibrary}
            isRefreshing={isRefreshingLibrary}
            items={libraryItems}
            loadingVideoId={loadingLibraryVideoId}
            stats={libraryStats}
            variant="home"
            onChangeFilter={setLibraryFilter}
            onClearAll={handleClearLibraryItems}
            onCopySourceUrl={handleCopyLibrarySourceUrl}
            onDeleteItem={handleDeleteLibraryItem}
            onLoadMore={handleLoadMoreLibraryItems}
            onOpenItem={handleOpenLibraryItem}
            onRefresh={handleRefreshLibraryItems}
          />
        </>
      ) : (
        <>
          <UrlInput
            errorMessage={errorMessage}
            isParsing={isParsing}
            value={url}
            onAnalyze={handleAnalyze}
            onChange={setUrl}
          />
          <section className="mx-auto grid min-w-0 max-w-[90rem] grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-14 pt-2 sm:px-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:px-10">
            <div className="contents lg:block">
              <VideoPreviewCard video={activeDetail?.video ?? null} />
              {activeDetail && isParseResponse(activeDetail) ? (
                <div className="order-3 lg:mt-5">
                  <FormatSelector
                    formatDiagnostics={activeDetail.format_diagnostics ?? null}
                    formats={activeDetail.formats ?? []}
                    isFromCache={Boolean(activeDetail.is_from_cache)}
                    sourceUrl={
                      !activeDetail.is_placeholder ? activeDetail.source_url : null
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="order-2 min-w-0 lg:order-none">
              <AiTabs
                activeTab={activeTab}
                canSummarize={canSummarize}
                canTranscribe={canTranscribe}
                hasTranscript={hasUsableContentText}
                mediaType={
                  activeDetail?.video ? getMediaType(activeDetail.video) : null
                }
                isSummarizing={isCurrentDetailSummarizing}
                isTranscribing={isCurrentDetailTranscribing}
                mindmapMarkdown={activeDetail?.mindmap_markdown ?? null}
                mindmapMeta={activeDetail?.mindmap_meta ?? null}
                noteDraft={activeDetail?.note_draft ?? null}
                summary={activeDetail?.summary ?? null}
                summaryDisplayState={summaryDisplayState}
                summaryErrorMessage={activeSummaryErrorMessage}
                summaryGenerationMeta={summaryGenerationMeta}
                summaryNotice={summaryNotice}
                transcribeErrorMessage={activeTranscribeErrorMessage}
                transcript={activeDetail?.transcript ?? null}
                textSourceType={
                  activeDetail?.video ? getTextSourceType(activeDetail.video) : null
                }
                sourceUrl={
                  activeDetail
                    ? isParseResponse(activeDetail)
                      ? activeDetail.source_url
                      : activeDetail.video.url
                    : null
                }
                videoAuthor={activeDetail?.video.author ?? null}
                videoPlatform={activeDetail?.video.platform ?? null}
                videoTitle={activeDetail?.video.title ?? null}
                onChangeTab={setActiveTab}
                onSaveNoteDraft={handleSaveNoteDraft}
                onSummarize={handleSummarize}
                onTranscribe={handleTranscribeRequest}
              />
            </div>
          </section>
          <RecentLibrary
            activeVideoId={activeLibraryVideoId}
            canLoadMore={canLoadMoreLibraryItems}
            copiedVideoId={copiedLibraryVideoId}
            deletingVideoId={deletingLibraryVideoId}
            disabled={loadingDemoId !== null}
            filter={libraryFilter}
            isClearing={isClearingLibrary}
            isRefreshing={isRefreshingLibrary}
            items={libraryItems}
            loadingVideoId={loadingLibraryVideoId}
            stats={libraryStats}
            variant="workbench"
            onChangeFilter={setLibraryFilter}
            onClearAll={handleClearLibraryItems}
            onCopySourceUrl={handleCopyLibrarySourceUrl}
            onDeleteItem={handleDeleteLibraryItem}
            onLoadMore={handleLoadMoreLibraryItems}
            onOpenItem={handleOpenLibraryItem}
            onRefresh={handleRefreshLibraryItems}
          />
        </>
      )}
      <TranscribeSettingsDialog
        asrEngine={pendingAsrEngine}
        cloudAvailable={asrStatus?.cloud_available ?? false}
        cloudModel={asrStatus?.cloud_model ?? null}
        isOpen={isTranscribeSettingsOpen}
        isTranscribing={isCurrentDetailTranscribing}
        mediaTitle={activeDetail?.video.title ?? null}
        settings={pendingTranscribeSettings}
        onChange={setPendingTranscribeSettings}
        onChangeAsrEngine={setPendingAsrEngine}
        onClose={() => setIsTranscribeSettingsOpen(false)}
        onConfirm={handleConfirmTranscribeSettings}
      />
      <TranscribeTaskToasts
        activeSourceUrl={activeSourceUrl}
        tasks={visibleTasks}
        onDismiss={handleDismissWorkbenchTask}
        onRetryLocally={handleRetryTranscribeLocally}
      />
    </main>
  );
}
