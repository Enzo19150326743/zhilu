"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ApiClientError, apiClient } from "@/lib/api";
import { getTextSourceType } from "@/lib/media";
import { pollForRecoveredValue } from "@/lib/transcribe-recovery";
import {
  getDefaultTranscribeSettings
} from "@/lib/transcribe-settings";
import {
  buildTranscribedDetail,
  getRecommendedLocalAsrEngine,
  isParseResponse,
  isRecoverableTranscribeError
} from "@/lib/workbench-detail";
import type {
  AsrEngine,
  AsrStatusResponse,
  DemoDetail,
  ParseResponse,
  TranscribeContextSettings,
  TranscribeTask
} from "@/lib/types";

type WorkbenchTab = "summary" | "mindmap" | "qa" | "transcript";
const TRANSCRIBE_RECOVERY_INTERVAL_MS = 5000;
const TRANSCRIBE_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;

interface UseTranscribeWorkflowOptions {
  activeDetail: DemoDetail | ParseResponse | null;
  activeSourceUrl: string | null;
  beginProcessingWorkflow: (workflow: {
    sourceUrl: string;
    startedAt: number;
    videoId: string;
  }) => void;
  finishProcessingWorkflow: (videoId: string) => void;
  isActiveSourceUrl: (sourceUrl: string) => boolean;
  refreshLibraryItems: () => Promise<void>;
  runSummaryForDetail: (detail: DemoDetail | ParseResponse) => Promise<void>;
  setActiveTab: Dispatch<SetStateAction<WorkbenchTab>>;
  setDetail: Dispatch<SetStateAction<DemoDetail | ParseResponse | null>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setSummaryErrorMessage: Dispatch<SetStateAction<string | null>>;
  setSummaryGenerationMeta: Dispatch<
    SetStateAction<{ isAiGenerated: boolean; model: string } | null>
  >;
}

export function useTranscribeWorkflow({
  activeDetail,
  activeSourceUrl,
  beginProcessingWorkflow,
  finishProcessingWorkflow,
  isActiveSourceUrl,
  refreshLibraryItems,
  runSummaryForDetail,
  setActiveTab,
  setDetail,
  setErrorMessage,
  setSummaryErrorMessage,
  setSummaryGenerationMeta
}: UseTranscribeWorkflowOptions) {
  const [transcribeTasks, setTranscribeTasks] = useState<TranscribeTask[]>([]);
  const [isTranscribeSettingsOpen, setIsTranscribeSettingsOpen] = useState(false);
  const [asrStatus, setAsrStatus] = useState<AsrStatusResponse | null>(null);
  const [pendingAsrEngine, setPendingAsrEngine] =
    useState<AsrEngine>("local_whisper");
  const [pendingTranscribeSettings, setPendingTranscribeSettings] =
    useState<TranscribeContextSettings>(() => getDefaultTranscribeSettings(null));

  useEffect(() => {
    apiClient
      .getAsrStatus()
      .then((response) => {
        setAsrStatus(response);
        setPendingAsrEngine(getRecommendedLocalAsrEngine(response));
      })
      .catch(() => setAsrStatus(null));
  }, []);

  const activeTranscribeTask = activeSourceUrl
    ? (transcribeTasks.find((task) => task.sourceUrl === activeSourceUrl) ?? null)
    : null;

  const waitForRecoveredTranscribeDetail = async (
    videoId: string,
    sourceUrl: string,
    transcriptVariantKey: AsrEngine,
    previousVariantJson: string | null
  ): Promise<ParseResponse | null> =>
    pollForRecoveredValue({
      fetchValue: () => apiClient.getLibraryDetail(videoId),
      intervalMs: TRANSCRIBE_RECOVERY_INTERVAL_MS,
      isRecovered: (detail) => {
        const recoveredVariant = detail.transcript_variants?.[transcriptVariantKey];
        return Boolean(
          detail.source_url === sourceUrl &&
            getTextSourceType(detail.video) === "asr_transcript" &&
            recoveredVariant?.plain_text.trim() &&
            JSON.stringify(recoveredVariant) !== previousVariantJson
        );
      },
      timeoutMs: TRANSCRIBE_RECOVERY_TIMEOUT_MS
    });

  const applyTranscribeSuccess = (
    taskId: string,
    taskSourceUrl: string,
    updatedDetail: ParseResponse,
    successMessage: string,
    continueWithSummary: boolean
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

    if (isActiveSourceUrl(taskSourceUrl)) {
      setSummaryGenerationMeta(null);
      setActiveTab(continueWithSummary ? "summary" : "transcript");
    }
    if (continueWithSummary) {
      void runSummaryForDetail(updatedDetail);
    } else {
      void refreshLibraryItems().finally(() => {
        finishProcessingWorkflow(updatedDetail.video.video_id);
      });
    }
  };

  const handleTranscribeRequest = () => {
    if (!activeDetail || !isParseResponse(activeDetail)) {
      setErrorMessage("当前记录无法生成转写稿，请先解析公开视频链接。");
      return;
    }
    if (
      activeDetail.video.has_transcript &&
      getTextSourceType(activeDetail.video) !== "shownotes" &&
      activeDetail.transcript?.plain_text.trim()
    ) {
      return;
    }
    if (
      transcribeTasks.some(
        (task) =>
          task.sourceUrl === activeDetail.source_url && task.status === "running"
      )
    ) {
      return;
    }

    setPendingTranscribeSettings(getDefaultTranscribeSettings(activeDetail.video));
    setPendingAsrEngine(getRecommendedLocalAsrEngine(asrStatus));
    setIsTranscribeSettingsOpen(true);
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
    const previousVariant = activeDetail.transcript_variants?.[asrEngine] ?? null;
    const previousVariantJson = previousVariant
      ? JSON.stringify(previousVariant)
      : null;

    if (
      transcribeTasks.some(
        (task) => task.sourceUrl === taskSourceUrl && task.status === "running"
      )
    ) {
      return;
    }

    const taskId = `${taskVideoId}-${Date.now()}`;
    beginProcessingWorkflow({
      sourceUrl: taskSourceUrl,
      startedAt: Date.now(),
      videoId: taskVideoId
    });
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

    try {
      const response = await apiClient.transcribeVideo({
        asr_engine: asrEngine,
        context_settings: settings ?? null,
        url: taskSourceUrl,
        video_id: taskVideoId
      });
      applyTranscribeSuccess(
        taskId,
        taskSourceUrl,
        buildTranscribedDetail(
          activeDetail,
          response.transcript,
          response.transcript_variant_key
        ),
        `${response.message} 正在继续生成总结。`,
        true
      );
    } catch (error) {
      if (isRecoverableTranscribeError(error)) {
        setTranscribeTasks((currentTasks) =>
          currentTasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  message:
                    error instanceof ApiClientError && error.errorCode === "TIMEOUT"
                      ? "请求等待超时，后台仍在处理，正在同步结果。"
                      : "连接中断，后台可能仍在处理，正在同步结果。",
                  status: "running"
                }
              : task
          )
        );
        const recoveredDetail = await waitForRecoveredTranscribeDetail(
          taskVideoId,
          taskSourceUrl,
          asrEngine,
          previousVariantJson
        );
        if (recoveredDetail) {
          applyTranscribeSuccess(
            taskId,
            taskSourceUrl,
            recoveredDetail,
            "逐字稿已生成，已从本地历史恢复结果。",
            true
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
      finishProcessingWorkflow(taskVideoId);
    }
  };

  const handleConfirmTranscribeSettings = () => {
    setIsTranscribeSettingsOpen(false);
    void startTranscribe(pendingTranscribeSettings, pendingAsrEngine);
  };

  return {
    activeTranscribeTask,
    handleConfirmTranscribeSettings,
    handleTranscribeRequest,
    setIsTranscribeSettingsOpen,
    setPendingAsrEngine,
    setPendingTranscribeSettings,
    transcribeSettingsDialogState: {
      asrStatus,
      isOpen: isTranscribeSettingsOpen,
      pendingAsrEngine,
      pendingTranscribeSettings
    },
    transcribeTasks
  };
}
