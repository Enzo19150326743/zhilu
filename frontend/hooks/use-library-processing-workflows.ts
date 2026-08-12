"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LIBRARY_PROCESSING_STORAGE_KEY,
  normalizeLibraryProcessingWorkflows,
  type LibraryProcessingWorkflow
} from "@/lib/library-processing";

function readStoredWorkflows(): LibraryProcessingWorkflow[] {
  try {
    const storedValue = window.sessionStorage.getItem(
      LIBRARY_PROCESSING_STORAGE_KEY
    );
    return normalizeLibraryProcessingWorkflows(
      storedValue ? JSON.parse(storedValue) : []
    );
  } catch {
    return [];
  }
}

function writeStoredWorkflows(workflows: LibraryProcessingWorkflow[]): void {
  try {
    if (workflows.length === 0) {
      window.sessionStorage.removeItem(LIBRARY_PROCESSING_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      LIBRARY_PROCESSING_STORAGE_KEY,
      JSON.stringify(workflows)
    );
  } catch {
    // NOTE: 会话存储不可用时仍保留当前页面内的真实任务状态。
  }
}

export function useLibraryProcessingWorkflows() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [restoredWorkflows, setRestoredWorkflows] = useState<
    LibraryProcessingWorkflow[]
  >([]);
  const [workflows, setWorkflows] = useState<LibraryProcessingWorkflow[]>([]);

  useEffect(() => {
    const storedWorkflows = readStoredWorkflows();
    setWorkflows(storedWorkflows);
    setRestoredWorkflows(storedWorkflows);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      writeStoredWorkflows(workflows);
    }
  }, [isHydrated, workflows]);

  const beginProcessingWorkflow = useCallback(
    (workflow: LibraryProcessingWorkflow) => {
      setWorkflows((currentWorkflows) =>
        normalizeLibraryProcessingWorkflows([
          workflow,
          ...currentWorkflows.filter(
            (currentWorkflow) => currentWorkflow.videoId !== workflow.videoId
          )
        ])
      );
    },
    []
  );

  const finishProcessingWorkflow = useCallback((videoId: string) => {
    setWorkflows((currentWorkflows) =>
      currentWorkflows.filter((workflow) => workflow.videoId !== videoId)
    );
    setRestoredWorkflows((currentWorkflows) =>
      currentWorkflows.filter((workflow) => workflow.videoId !== videoId)
    );
  }, []);

  const clearProcessingWorkflows = useCallback(() => {
    setWorkflows([]);
    setRestoredWorkflows([]);
  }, []);

  const processingVideoIds = useMemo(
    () => new Set(workflows.map((workflow) => workflow.videoId)),
    [workflows]
  );

  return {
    beginProcessingWorkflow,
    clearProcessingWorkflows,
    finishProcessingWorkflow,
    isHydrated,
    processingVideoIds,
    restoredWorkflows
  };
}
