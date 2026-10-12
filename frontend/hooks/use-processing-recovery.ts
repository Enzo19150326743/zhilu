"use client";

import { useEffect, useRef } from "react";
import { apiClient } from "@/lib/api";
import {
  LIBRARY_PROCESSING_TIMEOUT_MS, type LibraryProcessingWorkflow
} from "@/lib/library-processing";
import { getTextSourceType } from "@/lib/media";
import { pollForRecoveredValue } from "@/lib/transcribe-recovery";
import type { ParseResponse } from "@/lib/types";

interface ProcessingRecoveryOptions {
  isHydrated: boolean;
  restoredWorkflows: LibraryProcessingWorkflow[];
  finishProcessingWorkflow: (videoId: string) => void;
  refreshLibraryItems: () => Promise<void>;
  runSummaryForDetail: (detail: ParseResponse) => Promise<void>;
}

function hasPersistedSummary(detail: ParseResponse): boolean {
  return Boolean(
    detail.video.has_transcript &&
    getTextSourceType(detail.video) !== "shownotes" &&
    (detail.library_summary_status === "ai_generated" ||
      detail.library_summary_status === "local_fallback")
  );
}

export function useProcessingRecovery({
  isHydrated, restoredWorkflows, finishProcessingWorkflow,
  refreshLibraryItems, runSummaryForDetail
}: ProcessingRecoveryOptions) {
  const mountedRef = useRef(true);
  const recoveredVideoIdsRef = useRef(new Set<string>());
  const runSummaryRef = useRef(runSummaryForDetail);
  useEffect(() => { runSummaryRef.current = runSummaryForDetail; }, [runSummaryForDetail]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    for (const workflow of restoredWorkflows) {
      if (recoveredVideoIdsRef.current.has(workflow.videoId)) continue;
      recoveredVideoIdsRef.current.add(workflow.videoId);
      const remainingTimeoutMs = Math.max(
        0, LIBRARY_PROCESSING_TIMEOUT_MS - (Date.now() - workflow.startedAt)
      );
      if (remainingTimeoutMs === 0) {
        finishProcessingWorkflow(workflow.videoId);
        continue;
      }
      void (async () => {
        const recoveredDetail = await pollForRecoveredValue({
          fetchValue: () => apiClient.getLibraryDetail(workflow.videoId),
          intervalMs: 5000,
          isRecovered: (detail) => hasPersistedSummary(detail) || Boolean(
            detail.video.has_transcript && getTextSourceType(detail.video) !== "shownotes" &&
            detail.transcript?.plain_text.trim()
          ),
          timeoutMs: remainingTimeoutMs
        });
        if (!mountedRef.current) return;
        if (!recoveredDetail) {
          finishProcessingWorkflow(workflow.videoId);
          return;
        }
        if (hasPersistedSummary(recoveredDetail)) {
          await refreshLibraryItems();
          finishProcessingWorkflow(workflow.videoId);
          return;
        }
        await runSummaryRef.current(recoveredDetail);
      })();
    }
  }, [isHydrated, restoredWorkflows, finishProcessingWorkflow, refreshLibraryItems]);
}
