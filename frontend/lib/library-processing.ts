export const LIBRARY_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;
export const LIBRARY_PROCESSING_STORAGE_KEY =
  "zhilu.library-processing-workflows.v1";

export interface LibraryProcessingWorkflow {
  sourceUrl: string;
  startedAt: number;
  videoId: string;
}

export function normalizeLibraryProcessingWorkflows(
  value: unknown,
  now = Date.now()
): LibraryProcessingWorkflow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const workflowsByVideoId = new Map<string, LibraryProcessingWorkflow>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<LibraryProcessingWorkflow>;
    const sourceUrl = candidate.sourceUrl?.trim();
    const videoId = candidate.videoId?.trim();
    const startedAt = candidate.startedAt;

    if (
      !sourceUrl ||
      !videoId ||
      typeof startedAt !== "number" ||
      !Number.isFinite(startedAt) ||
      startedAt > now ||
      now - startedAt >= LIBRARY_PROCESSING_TIMEOUT_MS
    ) {
      continue;
    }

    const existingWorkflow = workflowsByVideoId.get(videoId);
    if (!existingWorkflow || existingWorkflow.startedAt <= startedAt) {
      workflowsByVideoId.set(videoId, { sourceUrl, startedAt, videoId });
    }
  }

  return [...workflowsByVideoId.values()].sort(
    (leftWorkflow, rightWorkflow) =>
      rightWorkflow.startedAt - leftWorkflow.startedAt
  );
}
