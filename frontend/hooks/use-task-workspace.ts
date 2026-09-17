"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api";
import type { AsrEngine, BatchTarget, TaskBatchResponse, TaskBatchSummary } from "@/lib/types";

const POLL_INTERVAL_MS = 2000;

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useTaskWorkspace() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState<TaskBatchResponse | null>(null);
  const [recentBatches, setRecentBatches] = useState<TaskBatchSummary[]>([]);
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const [activeVideoIds, setActiveVideoIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(() => new Set());
  const requestIdRef = useRef(createRequestId());

  const refreshList = useCallback(async () => {
    const response = await apiClient.getTaskBatches();
    setRecentBatches(response.batches);
    setActiveTaskCount(response.active_task_count);
    setActiveVideoIds(response.active_video_ids);
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

  useEffect(() => {
    if (!isWorkspaceOpen || !activeBatch || activeBatch.stats.active === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await apiClient.getTaskBatch(activeBatch.batch_id);
        if (cancelled) return;
        setErrorMessage(null);
        setActiveBatch(response);
        await refreshList();
        if (!cancelled && response.stats.active > 0) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "任务状态刷新失败，正在等待重连。");
          timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };
    timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeBatch?.batch_id, activeBatch?.stats.active, isWorkspaceOpen, refreshList]);

  useEffect(() => {
    if (activeTaskCount === 0 || isWorkspaceOpen) return;
    const timer = window.setInterval(() => {
      void refreshList().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeTaskCount, isWorkspaceOpen, refreshList]);

  const submitBatch = async (urls: string[], target: BatchTarget, asrEngine: AsrEngine) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await apiClient.createTaskBatch({
        client_request_id: requestIdRef.current,
        urls,
        target,
        asr_engine: asrEngine,
        context_settings: null
      });
      setActiveBatch(response);
      setIsDialogOpen(false);
      setIsWorkspaceOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.set("batch", response.batch_id);
      window.history.replaceState(null, "", url);
      requestIdRef.current = createRequestId();
      await refreshList().catch(() => undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批次提交失败，请稍后重试。");
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
    activeBatch, activeTaskCount, activeVideoIds, busyTaskIds, errorMessage, isDialogOpen, isSubmitting,
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
    submitBatch,
    cancelTask: (taskId: string) => runItemAction("cancel", taskId),
    retryTask: (taskId: string) => runItemAction("retry", taskId)
  };
}
