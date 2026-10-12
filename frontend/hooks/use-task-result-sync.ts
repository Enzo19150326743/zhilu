"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { apiClient } from "@/lib/api";
import { getSummaryMetaFromDetail } from "@/lib/workbench-detail";
import type {
  DemoDetail, ParseResponse, ProcessingTaskItem, SummaryGenerationMeta
} from "@/lib/types";

interface TaskResultSyncOptions {
  task: ProcessingTaskItem | null;
  activeSourceUrl: string | null;
  setDetail: Dispatch<SetStateAction<DemoDetail | ParseResponse | null>>;
  setSummaryGenerationMeta: (value: SummaryGenerationMeta | null) => void;
  setErrorMessage: (message: string | null) => void;
  refreshLibraryItems: () => Promise<void>;
}

export function useTaskResultSync({
  task, activeSourceUrl, setDetail, setSummaryGenerationMeta,
  setErrorMessage, refreshLibraryItems
}: TaskResultSyncOptions) {
  const activeSourceUrlRef = useRef(activeSourceUrl);
  useEffect(() => {
    activeSourceUrlRef.current = activeSourceUrl;
  }, [activeSourceUrl]);

  useEffect(() => {
    const videoId = task?.video_id;
    if (!videoId || !activeSourceUrl) return;
    let cancelled = false;
    const isRelevant = () => !cancelled && activeSourceUrlRef.current === activeSourceUrl;

    void (async () => {
      try {
        const response = await apiClient.getLibraryDetail(videoId);
        if (!isRelevant()) return;
        // 后台只更新仍在阅读的对象；详情导航始终由用户操作负责。
        setDetail((current) => current?.video.video_id === videoId ? response : current);
        setSummaryGenerationMeta(getSummaryMetaFromDetail(response));
        if (task?.status === "succeeded") {
          setErrorMessage(null);
          await refreshLibraryItems();
        }
      } catch (error) {
        if (isRelevant() && task?.status === "succeeded") {
          setErrorMessage(error instanceof Error ? error.message : "任务已完成，但结果暂时无法打开。");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    task?.task_id, task?.video_id, task?.stage, task?.status, task?.updated_at,
    activeSourceUrl, setDetail, setSummaryGenerationMeta, setErrorMessage, refreshLibraryItems
  ]);
}
