"use client";

import { useEffect, useRef, useState } from "react";
import { useDemoLibrary } from "@/hooks/use-demo-library";
import { useLibraryProcessingWorkflows } from "@/hooks/use-library-processing-workflows";
import { useLibraryWorkspace } from "@/hooks/use-library-workspace";
import { useSummaryWorkflow } from "@/hooks/use-summary-workflow";
import { useTranscribeWorkflow } from "@/hooks/use-transcribe-workflow";
import { apiClient } from "@/lib/api";
import { LIBRARY_PROCESSING_TIMEOUT_MS } from "@/lib/library-processing";
import { getMediaType, getTextSourceType } from "@/lib/media";
import { pollForRecoveredValue } from "@/lib/transcribe-recovery";
import {
  getSummaryMetaFromDetail,
  isParseResponse,
  shouldAutoSummarizeDetail
} from "@/lib/workbench-detail";
import type {
  AppStatus,
  DemoDetail,
  LibraryItem,
  NoteDraft,
  ParseTask,
  ParseResponse,
  SummaryDisplayState
} from "@/lib/types";

type TabKey = "summary" | "mindmap" | "qa" | "transcript";

const RESTORED_WORKFLOW_POLL_INTERVAL_MS = 5000;
function hasPersistedSummary(detail: ParseResponse): boolean {
  return Boolean(
    detail.video.has_transcript &&
      getTextSourceType(detail.video) !== "shownotes" &&
      (detail.library_summary_status === "ai_generated" ||
        detail.library_summary_status === "local_fallback")
  );
}

export function useWorkbenchController() {
  const { demos, isReady: areDemosReady } = useDemoLibrary();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {
    beginProcessingWorkflow,
    clearProcessingWorkflows,
    finishProcessingWorkflow,
    isHydrated: isProcessingWorkflowHydrated,
    processingVideoIds,
    restoredWorkflows
  } = useLibraryProcessingWorkflows();
  const {
    actionError: libraryActionError,
    canLoadMore: canLoadMoreLibraryItems,
    cancelPendingAction: cancelPendingLibraryAction,
    confirmPendingAction: confirmPendingLibraryAction,
    copiedVideoId: copiedLibraryVideoId,
    copySourceUrl: handleCopyLibrarySourceUrl,
    deletingVideoId: deletingLibraryVideoId,
    filter: libraryFilter,
    isClearing: isClearingLibrary,
    isLoading: isLibraryLoading,
    isRefreshing: isRefreshingLibrary,
    items: libraryItems,
    loadMore: handleLoadMoreLibraryItems,
    pendingAction: pendingLibraryAction,
    refresh: refreshLibraryItems,
    refreshManually: handleRefreshLibraryItems,
    requestClear: handleClearLibraryItems,
    requestDelete: handleDeleteLibraryItem,
    resetInteractionState: resetLibraryInteractionState,
    setFilter: setLibraryFilter,
    stats: libraryStats
  } = useLibraryWorkspace({ onError: setErrorMessage });
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);
  const [loadingDemoId, setLoadingDemoId] = useState<string | null>(null);
  const [loadingLibraryVideoId, setLoadingLibraryVideoId] = useState<string | null>(
    null
  );
  const [detail, setDetail] = useState<DemoDetail | ParseResponse | null>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [parseTasks, setParseTasks] = useState<ParseTask[]>([]);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const activeSourceUrlRef = useRef<string | null>(null);
  const inputUrlRef = useRef("");
  const isControllerMountedRef = useRef(true);
  const restoredRecoveryVideoIdsRef = useRef<Set<string>>(new Set());

  const activeDetail =
    detail && (status === "parsed" || status === "loading") ? detail : null;
  const activeLibraryVideoId =
    activeDetail && isParseResponse(activeDetail)
      ? activeDetail.video.video_id
      : null;
  const activeSourceUrl =
    activeDetail && isParseResponse(activeDetail) ? activeDetail.source_url : null;
  const trimmedInputUrl = url.trim();
  const isParsing = Boolean(
    trimmedInputUrl &&
      parseTasks.some(
        (task) => task.sourceUrl === trimmedInputUrl && task.status === "running"
      )
  );
  useEffect(() => {
    activeSourceUrlRef.current = activeSourceUrl;
  }, [activeSourceUrl]);

  useEffect(() => {
    inputUrlRef.current = url;
  }, [url]);

  const isTaskSourceActive = (sourceUrl: string): boolean =>
    activeSourceUrlRef.current === sourceUrl ||
    inputUrlRef.current.trim() === sourceUrl;
  const {
    activeSummaryTask,
    runSummaryForDetail,
    setSummaryErrorMessage,
    setSummaryGenerationMeta,
    summaryErrorMessage,
    summaryGenerationMeta,
    summaryTasks
  } = useSummaryWorkflow({
    activeSourceUrl,
    isTaskSourceActive,
    onProcessingFinished: finishProcessingWorkflow,
    refreshLibraryItems,
    setActiveTab,
    setDetail
  });
  const {
    activeTranscribeTask,
    handleConfirmTranscribeSettings,
    handleTranscribeRequest,
    setIsTranscribeSettingsOpen,
    setPendingAsrEngine,
    setPendingTranscribeSettings,
    transcribeSettingsDialogState,
    transcribeTasks
  } = useTranscribeWorkflow({
    activeDetail,
    activeSourceUrl,
    beginProcessingWorkflow,
    finishProcessingWorkflow,
    isActiveSourceUrl: (sourceUrl) =>
      activeSourceUrlRef.current === sourceUrl,
    refreshLibraryItems,
    runSummaryForDetail,
    setActiveTab,
    setDetail,
    setErrorMessage,
    setSummaryErrorMessage,
    setSummaryGenerationMeta
  });
  const runSummaryForDetailRef = useRef(runSummaryForDetail);

  useEffect(() => {
    runSummaryForDetailRef.current = runSummaryForDetail;
  }, [runSummaryForDetail]);

  useEffect(() => {
    isControllerMountedRef.current = true;
    return () => {
      isControllerMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isProcessingWorkflowHydrated) {
      return;
    }

    for (const workflow of restoredWorkflows) {
      if (restoredRecoveryVideoIdsRef.current.has(workflow.videoId)) {
        continue;
      }
      restoredRecoveryVideoIdsRef.current.add(workflow.videoId);

      const remainingTimeoutMs = Math.max(
        0,
        LIBRARY_PROCESSING_TIMEOUT_MS - (Date.now() - workflow.startedAt)
      );
      if (remainingTimeoutMs === 0) {
        finishProcessingWorkflow(workflow.videoId);
        continue;
      }

      void (async () => {
        const recoveredDetail = await pollForRecoveredValue({
          fetchValue: () => apiClient.getLibraryDetail(workflow.videoId),
          intervalMs: RESTORED_WORKFLOW_POLL_INTERVAL_MS,
          isRecovered: (candidateDetail) =>
            hasPersistedSummary(candidateDetail) ||
            Boolean(
              candidateDetail.video.has_transcript &&
                getTextSourceType(candidateDetail.video) !== "shownotes" &&
                candidateDetail.transcript?.plain_text.trim()
            ),
          timeoutMs: remainingTimeoutMs
        });

        if (!isControllerMountedRef.current) {
          return;
        }
        if (!recoveredDetail) {
          finishProcessingWorkflow(workflow.videoId);
          return;
        }
        if (hasPersistedSummary(recoveredDetail)) {
          await refreshLibraryItems();
          finishProcessingWorkflow(workflow.videoId);
          return;
        }

        await runSummaryForDetailRef.current(recoveredDetail);
      })();
    }
  }, [
    finishProcessingWorkflow,
    isProcessingWorkflowHydrated,
    refreshLibraryItems,
    restoredWorkflows
  ]);
  const {
    asrStatus,
    isOpen: isTranscribeSettingsOpen,
    pendingAsrEngine,
    pendingTranscribeSettings
  } = transcribeSettingsDialogState;
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
      !hasFullTranscript &&
      !isCurrentDetailSummarizing &&
      !isCurrentDetailTranscribing
  );
  const summaryDisplayState: SummaryDisplayState = !activeDetail
    ? "empty"
    : isParseResponse(activeDetail)
      ? summaryGenerationMeta && hasFullTranscript
        ? "generated"
        : "empty"
      : "demo";

  const handleAnalyze = async () => {
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
      return;
    }

    const taskId = `${Date.now()}-parse`;
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryGenerationMeta(null);
    setLoadingDemoId(null);
    setParseTasks((currentTasks) => [
      {
        id: taskId,
        kind: "parse",
        sourceUrl: trimmedUrl,
        title: trimmedUrl,
        status: "running",
        startedAt: Date.now()
      },
      ...currentTasks.filter((task) => task.sourceUrl !== trimmedUrl)
    ]);

    try {
      const response = await apiClient.parseVideo(trimmedUrl);
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
        setSummaryGenerationMeta(getSummaryMetaFromDetail(response));
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
    setSummaryGenerationMeta(null);
    setLoadingDemoId(demoId);
    setLoadingLibraryVideoId(null);
    setActiveDemoId(demoId);

    try {
      const response = await apiClient.getDemoDetail(demoId);
      setDetail(response);
    } catch (error) {
      setStatus(detail ? "parsed" : "error");
      setErrorMessage(
        error instanceof Error ? error.message : "展示内容打开失败，请稍后重试。"
      );
      return;
    } finally {
      setLoadingDemoId(null);
    }

    setStatus("parsed");
    setActiveTab("summary");
    window.scrollTo({ behavior: "auto", left: 0, top: 0 });
  };

  const handleGoHome = () => {
    setDetail(null);
    setActiveDemoId(null);
    setLoadingDemoId(null);
    setLoadingLibraryVideoId(null);
    resetLibraryInteractionState();
    setUrl("");
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryGenerationMeta(null);
    setActiveTab("summary");
    setStatus("idle");
    window.scrollTo({ behavior: "auto", left: 0, top: 0 });
  };

  const handleOpenLibraryItem = async (item: LibraryItem) => {
    setStatus("loading");
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setLoadingDemoId(null);
    setLoadingLibraryVideoId(item.video_id);
    setActiveDemoId(null);

    try {
      const response = await apiClient.getLibraryDetail(item.video_id);
      setDetail(response);
      setUrl(response.source_url);
      setSummaryGenerationMeta(getSummaryMetaFromDetail(response));
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

  const handleConfirmLibraryAction = async () => {
    const confirmedAction = await confirmPendingLibraryAction();
    if (!confirmedAction) {
      return;
    }
    if (confirmedAction.kind === "clear") {
      clearProcessingWorkflows();
      if (activeLibraryVideoId !== null) {
        handleGoHome();
      }
      return;
    }

    finishProcessingWorkflow(confirmedAction.videoId);
    if (confirmedAction.videoId === activeLibraryVideoId) {
      handleGoHome();
    }
  };

  const handleSummarize = async () => {
    if (!activeDetail) {
      setSummaryErrorMessage("当前没有可用于总结的内容文本。");
      return;
    }

    await runSummaryForDetail(activeDetail);
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
    void refreshLibraryItems();
    return response.note_draft;
  };

  const handleDismissWorkbenchTask = (taskId: string) => {
    setHiddenTaskIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(taskId);
      return nextIds;
    });
  };

  const visibleTasks = [...parseTasks, ...summaryTasks, ...transcribeTasks]
    .filter((task) => !hiddenTaskIds.has(task.id))
    .sort((leftTask, rightTask) => rightTask.startedAt - leftTask.startedAt);
  const isLibraryActionBusy = Boolean(
    isClearingLibrary || deletingLibraryVideoId
  );
  const pendingLibraryActionTitle =
    pendingLibraryAction?.kind === "delete"
      ? "删除档案"
      : "清空全部档案";
  const pendingLibraryActionDescription =
    pendingLibraryAction?.kind === "delete"
      ? "删除这条档案？"
      : "清空全部档案？此操作无法撤销。";
  const libraryViewProps = {
    activeVideoId: activeLibraryVideoId,
    canLoadMore: canLoadMoreLibraryItems,
    copiedVideoId: copiedLibraryVideoId,
    deletingVideoId: deletingLibraryVideoId,
    disabled: loadingDemoId !== null,
    filter: libraryFilter,
    isClearing: isClearingLibrary,
    isLoading: isLibraryLoading,
    isRefreshing: isRefreshingLibrary,
    items: libraryItems,
    loadingVideoId: loadingLibraryVideoId,
    processingVideoIds,
    stats: libraryStats,
    onChangeFilter: setLibraryFilter,
    onClearAll: handleClearLibraryItems,
    onCopySourceUrl: handleCopyLibrarySourceUrl,
    onDeleteItem: handleDeleteLibraryItem,
    onLoadMore: handleLoadMoreLibraryItems,
    onOpenItem: handleOpenLibraryItem,
    onRefresh: handleRefreshLibraryItems
  };

  const homeWorkspaceProps = {
    heroProps: {
      demos,
      errorMessage,
      isParsing,
      loadingDemoId,
      url,
      onAnalyze: handleAnalyze,
      onChangeUrl: setUrl,
      onLoadDemo: handleLoadDemo
    },
    libraryProps: libraryViewProps
  };
  const workbenchWorkspaceProps = activeDetail
    ? {
        aiTabsProps: {
          activeTab,
          activeTranscriptVariant: activeDetail.active_transcript_variant ?? null,
          canSummarize,
          canTranscribe,
          hasTranscript: hasUsableContentText,
          isSummarizing: isCurrentDetailSummarizing,
          isTranscribing: isCurrentDetailTranscribing,
          mediaType: getMediaType(activeDetail.video),
          mindmapMarkdown: activeDetail.mindmap_markdown ?? null,
          mindmapMeta: activeDetail.mindmap_meta ?? null,
          noteDraft: activeDetail.note_draft ?? null,
          sourceUrl: isParseResponse(activeDetail)
            ? activeDetail.source_url
            : activeDetail.video.url,
          summary: activeDetail.summary ?? null,
          summaryDisplayState,
          summaryErrorMessage: activeSummaryErrorMessage,
          summaryGenerationMeta,
          textSourceType: getTextSourceType(activeDetail.video),
          transcribeErrorMessage: activeTranscribeErrorMessage,
          transcript: activeDetail.transcript ?? null,
          transcriptVariants: activeDetail.transcript_variants ?? {},
          videoAuthor: activeDetail.video.author ?? null,
          videoTitle: activeDetail.video.title ?? null,
          onChangeTab: setActiveTab,
          onSaveNoteDraft: handleSaveNoteDraft,
          onSummarize: handleSummarize,
          onTranscribe: handleTranscribeRequest
        },
        detail: activeDetail,
        urlInputProps: {
          errorMessage,
          isParsing,
          value: url,
          onAnalyze: handleAnalyze,
          onChange: setUrl
        }
      }
    : null;

  return {
    activeDetail,
    confirmDialogProps: {
      confirmLabel:
        pendingLibraryAction?.kind === "delete" ? "删除" : "清空",
      description: pendingLibraryActionDescription,
      errorMessage: libraryActionError,
      isBusy: isLibraryActionBusy,
      isOpen: pendingLibraryAction !== null,
      title: pendingLibraryActionTitle,
      onClose: cancelPendingLibraryAction,
      onConfirm: handleConfirmLibraryAction
    },
    homeWorkspaceProps,
    isHomeWorkspaceReady: areDemosReady && !isLibraryLoading,
    onHomeClick: handleGoHome,
    transcribeSettingsDialogProps: {
      asrEngine: pendingAsrEngine,
      sensevoiceAvailable: asrStatus?.sensevoice_available ?? false,
      correctionAvailable: asrStatus?.correction_available ?? false,
      isOpen: isTranscribeSettingsOpen,
      isTranscribing: isCurrentDetailTranscribing,
      settings: pendingTranscribeSettings,
      onChange: setPendingTranscribeSettings,
      onChangeAsrEngine: setPendingAsrEngine,
      onClose: () => setIsTranscribeSettingsOpen(false),
      onConfirm: handleConfirmTranscribeSettings
    },
    transcribeTaskToastsProps: {
      tasks: visibleTasks,
      onDismiss: handleDismissWorkbenchTask
    },
    workbenchWorkspaceProps
  };
}
