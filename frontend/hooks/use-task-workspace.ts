"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api";
import type { TaskBatchResponse, TaskBatchSummary, TranscribeContextSettings } from "@/lib/types";

import { TASK_POLL_INTERVAL_MS, useBatchPolling } from "@/hooks/use-batch-polling";

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useTaskWorkspace() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState<TaskBatchResponse | null>(null);
  const [activeSingleBatch, setActiveSingleBatch] = useState<TaskBatchResponse | null>(null);
  const [recentBatches, setRecentBatches] = useState<TaskBatchSummary[]>([]);
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const [activeVideoIds, setActiveVideoIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(() => new Set());
  const requestIdRef = useRef(createRequestId());
  const listRequestVersionRef = useRef(0);

  const refreshList = useCallback(async () => {
    const requestVersion = ++listRequestVersionRef.current;
    const response = await apiClient.getTaskBatches();
    if (requestVersion !== listRequestVersionRef.current) return;
    setRecentBatches(response.batches ?? []);
    setActiveTaskCount(response.active_task_count ?? 0);
    setActiveVideoIds(response.active_video_ids ?? []);
  }, []);

  const openBatch = useCallback(async (batchId: string) => {
    setErrorMessage(null);
    const response = await apiClient.getTaskBatch(batchId);
    setActiveBatch(response);
    setIsWorkspaceOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set("batch", batchId);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshList().catch(() => undefined);
      const batchId = new URL(window.location.href).searchParams.get("batch");
      if (batchId) await openBatch(batchId).catch(() => undefined);
    })();
  }, [openBatch, refreshList]);

  useBatchPolling({
    batch: activeBatch,
    onSnapshot: setActiveBatch,
    refreshList,
    setErrorMessage,
    failureMessage: "任务状态刷新失败，正在等待重连。"
  });
  useBatchPolling({
    batch: activeSingleBatch,
    onSnapshot: setActiveSingleBatch,
    refreshList,
    setErrorMessage,
    failureMessage: "单条任务状态刷新失败，正在等待重连。"
  });

  useEffect(() => {
    if (activeTaskCount === 0 || isWorkspaceOpen) return;
    const timer = window.setInterval(() => {
      void refreshList().catch(() => undefined);
    }, TASK_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeTaskCount, isWorkspaceOpen, refreshList]);

  const submitBatch = async (
    urls: string[],
    contextSettings: TranscribeContextSettings | null = null
  ) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await apiClient.createTaskBatch({
        client_request_id: requestIdRef.current,
        urls,
        context_settings: contextSettings
      });
      setActiveBatch(response);
      setIsDialogOpen(false);
      setIsWorkspaceOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.set("batch", response.batch_id);
      window.history.replaceState(null, "", url);
      requestIdRef.current = createRequestId();
      void refreshList().catch(() => undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批次提交失败，请稍后重试。");
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitSingle = async (
    sourceUrl: string
  ): Promise<TaskBatchResponse> => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await apiClient.createTaskBatch({
        client_request_id: createRequestId(),
        urls: [sourceUrl],
        context_settings: null
      });
      setActiveSingleBatch(response);
      setIsWorkspaceOpen(false);
      void refreshList().catch(() => undefined);
      return response;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "提炼任务提交失败，请稍后重试。"
      );
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const runItemAction = async (kind: "cancel" | "retry", taskId: string) => {
    if (!activeBatch) return;
    if (busyTaskIds.has(taskId)) return;
    setBusyTaskIds((current) => new Set(current).add(taskId));
    setErrorMessage(null);
    try {
      if (kind === "cancel") await apiClient.cancelTask(taskId, activeBatch.batch_id);
      else await apiClient.retryTask(taskId, activeBatch.batch_id);
      await openBatch(activeBatch.batch_id);
      await refreshList();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "任务操作失败，请稍后重试。");
    } finally {
      setBusyTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  };

  return {
    activeBatch, activeSingleBatch, activeTaskCount, activeVideoIds, busyTaskIds, errorMessage, isDialogOpen, isSubmitting,
    isWorkspaceOpen, recentBatches,
    closeDialog: () => !isSubmitting && setIsDialogOpen(false),
    closeWorkspace: () => {
      setIsWorkspaceOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("batch");
      window.history.replaceState(null, "", url);
    },
    openBatch,
    openDialog: () => { setErrorMessage(null); setIsDialogOpen(true); },
    refreshList,
    submitSingle,
    submitBatch,
    clearActiveSingleBatch: () => setActiveSingleBatch(null),
    cancelTask: (taskId: string) => runItemAction("cancel", taskId),
    retryTask: (taskId: string) => runItemAction("retry", taskId)
  };
}
