"use client";

import { useEffect } from "react";
import { apiClient } from "@/lib/api";
import type { TaskBatchResponse } from "@/lib/types";

export const TASK_POLL_INTERVAL_MS = 2000;

interface BatchPollingOptions {
  batch: TaskBatchResponse | null;
  onSnapshot: (batch: TaskBatchResponse) => void;
  refreshList: () => Promise<void>;
  setErrorMessage: (message: string | null) => void;
  failureMessage: string;
}

export function useBatchPolling({
  batch, onSnapshot, refreshList, setErrorMessage, failureMessage
}: BatchPollingOptions) {
  const batchId = batch?.batch_id;
  const activeCount = batch?.stats.active ?? 0;

  useEffect(() => {
    if (!batchId || activeCount === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await apiClient.getTaskBatch(batchId);
        if (cancelled) return;
        setErrorMessage(null);
        onSnapshot(response);
        await refreshList();
        if (!cancelled && response.stats.active > 0) {
          timer = window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : failureMessage);
          timer = window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
        }
      }
    };
    timer = window.setTimeout(poll, TASK_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [batchId, activeCount, onSnapshot, refreshList, setErrorMessage, failureMessage]);
}
