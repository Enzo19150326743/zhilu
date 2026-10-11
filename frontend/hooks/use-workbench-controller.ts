"use client";

import { useEffect, useRef, useState } from "react";
import { useDemoLibrary } from "@/hooks/use-demo-library";
import { useLibraryProcessingWorkflows } from "@/hooks/use-library-processing-workflows";
import { useLibraryWorkspace } from "@/hooks/use-library-workspace";
import { useSummaryWorkflow } from "@/hooks/use-summary-workflow";
import { useTaskWorkspace } from "@/hooks/use-task-workspace";
import { useTranscribeWorkflow } from "@/hooks/use-transcribe-workflow";
import { apiClient } from "@/lib/api";
import { LIBRARY_PROCESSING_TIMEOUT_MS } from "@/lib/library-processing";
import { getMediaType, getTextSourceType } from "@/lib/media";
import { parseBatchInput } from "@/lib/batch-input";
import { pollForRecoveredValue } from "@/lib/transcribe-recovery";
import { getSummaryMetaFromDetail, isParseResponse } from "@/lib/workbench-detail";
import type {
  AppStatus,
  DemoDetail,
  LibraryItem,
  NoteDraft,
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
  const taskWorkspace = useTaskWorkspace();
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
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const activeSourceUrlRef = useRef<string | null>(null);
  const isControllerMountedRef = useRef(true);
  const restoredRecoveryVideoIdsRef = useRef<Set<string>>(new Set());
  const batchTaskSyncKeyRef = useRef("");
  const singleTaskSyncKeyRef = useRef("");
  const submissionInFlightRef = useRef(false);

  const activeDetail =
    detail && (status === "parsed" || status === "loading") ? detail : null;
  const activeLibraryVideoId =
    activeDetail && isParseResponse(activeDetail)
      ? activeDetail.video.video_id
      : null;
  const activeSourceUrl =
    activeDetail && isParseResponse(activeDetail) ? activeDetail.source_url : null;
  const activeSingleTask = taskWorkspace.activeSingleBatch?.items[0] ?? null;
  const isSubmitting = taskWorkspace.isSubmitting;
  const activeVideoIdsKey = taskWorkspace.activeVideoIds.join("|");
  const observedActiveVideoIdsRef = useRef(activeVideoIdsKey);
  useEffect(() => {
    if (observedActiveVideoIdsRef.current === activeVideoIdsKey) return;
    observedActiveVideoIdsRef.current = activeVideoIdsKey;
    void refreshLibraryItems();
  }, [activeVideoIdsKey, refreshLibraryItems]);
  useEffect(() => {
    activeSourceUrlRef.current = activeSourceUrl;
  }, [activeSourceUrl]);

  const isTaskSourceActive = (sourceUrl: string): boolean =>
    activeSourceUrlRef.current === sourceUrl;
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
    pendingTranscribeSettings
  } = transcribeSettingsDialogState;
  useEffect(() => {
    if (!activeSingleTask) {
      return;
    }

    const syncKey = [
      activeSingleTask.task_id,
      activeSingleTask.video_id ?? "",
      activeSingleTask.stage,
      activeSingleTask.status,
      activeSingleTask.updated_at
    ].join("|");
    if (singleTaskSyncKeyRef.current === syncKey) {
      return;
    }
    singleTaskSyncKeyRef.current = syncKey;

    void refreshLibraryItems();
    const isTaskRelevant = () => activeSourceUrlRef.current === activeSingleTask.source_url;
    if (!isTaskRelevant()) {
      return;
    }

    if (activeSingleTask.status === "failed") {
      setErrorMessage(activeSingleTask.error_message ?? "这条内容提炼失败，可以在任务中重试。");
      return;
    }
    if (activeSingleTask.status === "cancelled") {
      setErrorMessage("这条内容的提炼任务已取消，已完成的结果仍会保留。");
      return;
    }
    if (!activeSingleTask.video_id) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await apiClient.getLibraryDetail(activeSingleTask.video_id!);
        if (cancelled || !isControllerMountedRef.current || !isTaskRelevant()) {
          return;
        }
        // 后台结果只刷新用户正在查看的同一篇内容，不承担页面导航。
        setDetail((currentDetail) =>
          currentDetail?.video.video_id === activeSingleTask.video_id ? response : currentDetail
        );
        setSummaryGenerationMeta(getSummaryMetaFromDetail(response));
        if (activeSingleTask.status === "succeeded") {
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled && isTaskRelevant() && activeSingleTask.status === "succeeded") {
          setErrorMessage(
            error instanceof Error ? error.message : "任务已完成，但结果暂时无法打开。"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeSingleTask?.error_message,
    activeSingleTask?.stage,
    activeSingleTask?.status,
    activeSingleTask?.task_id,
    activeSingleTask?.updated_at,
    activeSingleTask?.video_id,
    refreshLibraryItems,
    setSummaryGenerationMeta
  ]);
  const taskMatchesDetail = (task: typeof activeSingleTask): boolean =>
    Boolean(
      task &&
        activeDetail &&
        (task.video_id === activeDetail.video.video_id ||
          (isParseResponse(activeDetail) && task.source_url === activeDetail.source_url))
    );
  const activeBatchDetailTask =
    taskWorkspace.activeBatch?.items.find((task) => taskMatchesDetail(task)) ?? null;
  const activePersistentDetailTask = taskMatchesDetail(activeSingleTask)
    ? activeSingleTask
    : activeBatchDetailTask;
  useEffect(() => {
    if (!activeBatchDetailTask?.video_id) return;

    const syncKey = [
      activeBatchDetailTask.task_id,
      activeBatchDetailTask.stage,
      activeBatchDetailTask.status,
      activeBatchDetailTask.updated_at
    ].join("|");
    if (batchTaskSyncKeyRef.current === syncKey) return;
    batchTaskSyncKeyRef.current = syncKey;

    let cancelled = false;
    void (async () => {
      try {
        const response = await apiClient.getLibraryDetail(activeBatchDetailTask.video_id!);
        if (
          cancelled ||
          !isControllerMountedRef.current ||
          activeSourceUrlRef.current !== response.source_url
        ) return;
        setDetail((currentDetail) =>
          currentDetail?.video.video_id === activeBatchDetailTask.video_id ? response : currentDetail
        );
        setSummaryGenerationMeta(getSummaryMetaFromDetail(response));
        if (activeBatchDetailTask.status === "succeeded") {
          setErrorMessage(null);
          await refreshLibraryItems();
        }
      } catch (error) {
        if (
          !cancelled &&
          activeSourceUrlRef.current === activeBatchDetailTask.source_url &&
          activeBatchDetailTask.status === "succeeded"
        ) {
          setErrorMessage(
            error instanceof Error ? error.message : "任务已完成，但最新结果暂时无法打开。"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeBatchDetailTask?.stage,
    activeBatchDetailTask?.status,
    activeBatchDetailTask?.task_id,
    activeBatchDetailTask?.updated_at,
    activeBatchDetailTask?.video_id,
    refreshLibraryItems,
    setSummaryGenerationMeta
  ]);
  const isPersistentDetailTaskActive = Boolean(
    activePersistentDetailTask &&
      ["queued", "running", "waiting_retry"].includes(activePersistentDetailTask.status)
  );
  const isCurrentDetailSummarizing = Boolean(
    activeSummaryTask?.status === "running" ||
      (isPersistentDetailTaskActive && activePersistentDetailTask?.stage === "summarize")
  );
  const isCurrentDetailTranscribing = Boolean(
    activeTranscribeTask?.status === "running" ||
      (isPersistentDetailTaskActive &&
        activePersistentDetailTask &&
        ["download", "recognize", "correct"].includes(activePersistentDetailTask.stage))
  );
  const activeSummaryErrorMessage =
    activeSummaryTask?.status === "error"
      ? (activeSummaryTask.errorMessage ?? null)
      : activePersistentDetailTask?.status === "failed" &&
          activePersistentDetailTask.stage === "summarize"
        ? (activePersistentDetailTask.error_message ?? "总结生成失败，可以在任务中重试。")
        : summaryErrorMessage;
  const activeTranscribeErrorMessage =
    activeTranscribeTask?.status === "error"
      ? (activeTranscribeTask.errorMessage ?? null)
      : activePersistentDetailTask?.status === "failed"
        ? (activePersistentDetailTask.error_message ?? null)
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
    : activeDemoId !== null
      ? "demo"
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

    if (parseBatchInput(trimmedUrl).urls.length > 1) {
      taskWorkspace.openDialog();
      return;
    }

    if (isSubmitting || submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    setErrorMessage(null);

    try {
      await taskWorkspace.submitSingle(trimmedUrl);
      // 只清空本次已提交的内容，保留请求期间用户填写的下一条链接。
      setUrl((currentUrl) => currentUrl.trim() === trimmedUrl ? "" : currentUrl);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "提炼任务提交失败，请稍后重试。"
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  const handleLoadDemo = async (demoId: string) => {
    setStatus("loading");
    setErrorMessage(null);
    setSummaryErrorMessage(null);
    setSummaryGenerationMeta(null);
    setLoadingDemoId(demoId);
    setLoadingLibraryVideoId(null);

    try {
      const response = await apiClient.getDemoDetail(demoId);
      setDetail(response);
      setActiveDemoId(demoId);
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

  const handleOpenTaskResult = async (videoId: string) => {
    taskWorkspace.closeWorkspace();
    setStatus("loading");
    setErrorMessage(null);
    setLoadingLibraryVideoId(videoId);
    try {
      const response = await apiClient.getLibraryDetail(videoId);
      setDetail(response);
      setActiveDemoId(null);
      setUrl(response.source_url);
      setSummaryGenerationMeta(getSummaryMetaFromDetail(response));
      setActiveTab("summary");
      setStatus("parsed");
      window.scrollTo({ behavior: "auto", left: 0, top: 0 });
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "任务结果打开失败，请稍后重试。");
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

  const visibleTasks = [...summaryTasks, ...transcribeTasks]
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
    processingVideoIds: new Set([...processingVideoIds, ...taskWorkspace.activeVideoIds]),
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
      isSubmitting,
      loadingDemoId,
      url,
      onAnalyze: handleAnalyze,
      onBatchAdd: taskWorkspace.openDialog,
      onChangeUrl: setUrl,
      onLoadDemo: handleLoadDemo
    },
    libraryProps: libraryViewProps
  };
  const workbenchWorkspaceProps = activeDetail
    ? {
        aiTabsProps: {
          activeTab,
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
          videoAuthor: activeDetail.video.author ?? null,
          videoTitle: activeDetail.video.title ?? null,
          onChangeTab: setActiveTab,
          onSaveNoteDraft: handleSaveNoteDraft,
          onSummarize: handleSummarize,
          onTranscribe: handleTranscribeRequest
        },
        detail: activeDetail,
        onBack: handleGoHome,
        urlInputProps: {
          errorMessage,
          isSubmitting,
          value: url,
          onAnalyze: handleAnalyze,
          onBatchAdd: taskWorkspace.openDialog,
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
    taskWorkspaceProps: taskWorkspace.activeBatch
      ? {
          batch: taskWorkspace.activeBatch,
          busyTaskIds: taskWorkspace.busyTaskIds,
          errorMessage: taskWorkspace.errorMessage,
          recentBatches: taskWorkspace.recentBatches,
          onAdd: taskWorkspace.openDialog,
          onBack: taskWorkspace.closeWorkspace,
          onCancel: taskWorkspace.cancelTask,
          onOpenBatch: taskWorkspace.openBatch,
          onOpenResult: handleOpenTaskResult,
          onRetry: taskWorkspace.retryTask
        }
      : null,
    batchDialogProps: {
      errorMessage: taskWorkspace.errorMessage,
      initialValue: url,
      isOpen: taskWorkspace.isDialogOpen,
      isSubmitting: taskWorkspace.isSubmitting,
      correctionAvailable: asrStatus?.correction_available ?? false,
      onClose: taskWorkspace.closeDialog,
      onSubmit: async (...args: Parameters<typeof taskWorkspace.submitBatch>) => {
        await taskWorkspace.submitBatch(...args);
        setUrl("");
      }
    },
    activeTaskCount: taskWorkspace.activeTaskCount,
    isTaskWorkspaceOpen: taskWorkspace.isWorkspaceOpen,
    onTasksClick: () => {
      const firstBatchId = taskWorkspace.activeBatch?.batch_id ?? taskWorkspace.recentBatches[0]?.batch_id;
      if (firstBatchId) void taskWorkspace.openBatch(firstBatchId);
      else taskWorkspace.openDialog();
    },
    isHomeWorkspaceReady: areDemosReady,
    onHomeClick: () => {
      taskWorkspace.closeWorkspace();
      handleGoHome();
    },
    transcribeSettingsDialogProps: {
      asrAvailable: asrStatus?.sensevoice_available ?? false,
      correctionAvailable: asrStatus?.correction_available ?? false,
      isOpen: isTranscribeSettingsOpen,
      isTranscribing: isCurrentDetailTranscribing,
      settings: pendingTranscribeSettings,
      onChange: setPendingTranscribeSettings,
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
