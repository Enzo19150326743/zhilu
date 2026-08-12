"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { apiClient } from "@/lib/api";
import { getMediaType, getTextSourceType } from "@/lib/media";
import {
  getSummaryTaskMessage,
  isParseResponse
} from "@/lib/workbench-detail";
import type {
  DemoDetail,
  ParseResponse,
  SummaryGenerationMeta,
  SummaryTask
} from "@/lib/types";

type WorkbenchTab = "summary" | "mindmap" | "qa" | "transcript";

interface UseSummaryWorkflowOptions {
  activeSourceUrl: string | null;
  isTaskSourceActive: (sourceUrl: string) => boolean;
  onProcessingFinished: (videoId: string) => void;
  refreshLibraryItems: () => Promise<void>;
  setActiveTab: Dispatch<SetStateAction<WorkbenchTab>>;
  setDetail: Dispatch<SetStateAction<DemoDetail | ParseResponse | null>>;
}

export function useSummaryWorkflow({
  activeSourceUrl,
  isTaskSourceActive,
  onProcessingFinished,
  refreshLibraryItems,
  setActiveTab,
  setDetail
}: UseSummaryWorkflowOptions) {
  const [summaryErrorMessage, setSummaryErrorMessage] = useState<string | null>(
    null
  );
  const [summaryTasks, setSummaryTasks] = useState<SummaryTask[]>([]);
  const [summaryGenerationMeta, setSummaryGenerationMeta] =
    useState<SummaryGenerationMeta | null>(null);
  const activeSummaryTask = activeSourceUrl
    ? (summaryTasks.find((task) => task.sourceUrl === activeSourceUrl) ?? null)
    : null;

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
        // NOTE: 后台总结必须按 source_url 回写，避免切换媒体后覆盖当前页面。
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
        if (!response.is_ai_generated && response.model !== "local-fallback") {
          setSummaryErrorMessage(taskMessage);
        }
        setActiveTab("summary");
      }
      await refreshLibraryItems();
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
      await refreshLibraryItems();
    } finally {
      onProcessingFinished(taskVideoId);
    }
  };

  return {
    activeSummaryTask,
    runSummaryForDetail,
    setSummaryErrorMessage,
    setSummaryGenerationMeta,
    summaryErrorMessage,
    summaryGenerationMeta,
    summaryTasks
  };
}
