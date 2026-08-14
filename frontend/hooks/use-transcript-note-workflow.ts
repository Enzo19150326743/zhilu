"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api";
import {
  buildDraftTextMap,
  buildManualHighlightFromExcerpt,
  downloadTextFile,
  EDIT_SAVE_DEBOUNCE_MS,
  EDIT_SAVED_MESSAGE_MS,
  extractSelectedExcerpt,
  getHighlightIdentity,
  getNoteErrorMessage,
  normalizeCandidateHighlight,
  type DraftEditStatus,
  type SelectedExcerpt
} from "@/lib/transcript-workbench";
import type { NoteDraft, SummaryHighlight, VideoSummary } from "@/lib/types";

interface UseTranscriptNoteWorkflowOptions {
  noteDraft?: NoteDraft | null;
  sourceUrl?: string | null;
  summary: VideoSummary | null;
  textSourceType?: string | null;
  onSaveNoteDraft: (sourceUrl: string, noteDraft: NoteDraft) => Promise<NoteDraft>;
}

export function useTranscriptNoteWorkflow({
  noteDraft,
  sourceUrl,
  summary,
  textSourceType,
  onSaveNoteDraft
}: UseTranscriptNoteWorkflowOptions) {
  const [draftHighlights, setDraftHighlights] = useState<SummaryHighlight[]>(
    () => noteDraft?.highlights ?? []
  );
  const [draftEditValues, setDraftEditValues] = useState<Record<string, string>>(
    () => buildDraftTextMap(noteDraft?.highlights ?? [])
  );
  const [draftEditStatuses, setDraftEditStatuses] = useState<
    Record<string, DraftEditStatus>
  >({});
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftErrorMessage, setDraftErrorMessage] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isExportingNote, setIsExportingNote] = useState(false);
  const [selectedExcerpt, setSelectedExcerpt] = useState<SelectedExcerpt | null>(
    null
  );
  const [recentlyAddedHighlightId, setRecentlyAddedHighlightId] = useState<
    string | null
  >(null);
  const transcriptTextRootRef = useRef<HTMLElement | null>(null);
  const isSelectingExcerptRef = useRef(false);
  const draftHighlightsRef = useRef<SummaryHighlight[]>(draftHighlights);
  const editSaveTimeoutsRef = useRef<Record<string, number>>({});
  const editStatusTimeoutsRef = useRef<Record<string, number>>({});
  const editRevisionRef = useRef<Record<string, number>>({});
  const lastSavedTextRef = useRef<Record<string, string>>(
    buildDraftTextMap(noteDraft?.highlights ?? [])
  );
  const candidateHighlights = useMemo(
    () => summary?.highlights ?? [],
    [summary?.highlights]
  );
  const savedHighlightIdentities = useMemo(
    () => new Set(draftHighlights.map(getHighlightIdentity)),
    [draftHighlights]
  );

  const readSelectedExcerpt = useCallback(
    () => extractSelectedExcerpt(transcriptTextRootRef.current),
    []
  );

  const handleExcerptPointerDown = () => {
    isSelectingExcerptRef.current = true;
    setSelectedExcerpt(null);
  };

  const handleExcerptPointerUp = () => {
    isSelectingExcerptRef.current = false;
    setSelectedExcerpt(readSelectedExcerpt());
  };

  useEffect(() => {
    setDraftHighlights(noteDraft?.highlights ?? []);
    const nextEditValues = buildDraftTextMap(noteDraft?.highlights ?? []);
    setDraftEditValues(nextEditValues);
    setDraftEditStatuses({});
    lastSavedTextRef.current = nextEditValues;
    setDraftMessage(null);
    setDraftErrorMessage(null);
    setRecentlyAddedHighlightId(null);
  }, [noteDraft, sourceUrl]);

  useEffect(() => {
    draftHighlightsRef.current = draftHighlights;
  }, [draftHighlights]);

  useEffect(() => {
    setSelectedExcerpt(null);
  }, [sourceUrl]);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (isSelectingExcerptRef.current) {
        return;
      }
      setSelectedExcerpt(readSelectedExcerpt());
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("scroll", handleSelectionChange, true);
    window.addEventListener("resize", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("scroll", handleSelectionChange, true);
      window.removeEventListener("resize", handleSelectionChange);
    };
  }, [readSelectedExcerpt]);

  useEffect(() => {
    return () => {
      Object.values(editSaveTimeoutsRef.current).forEach(window.clearTimeout);
      Object.values(editStatusTimeoutsRef.current).forEach(window.clearTimeout);
    };
  }, []);

  const persistDraft = async (
    nextHighlights: SummaryHighlight[],
    successMessage: string,
    addedHighlightId?: string
  ) => {
    if (!sourceUrl) {
      setDraftErrorMessage("当前内容没有可保存的源链接。");
      return;
    }

    const nextDraft: NoteDraft = {
      highlights: nextHighlights,
      updated_at: new Date().toISOString()
    };
    const previousHighlights = draftHighlights;
    const previousEditValues = draftEditValues;
    setDraftHighlights(nextHighlights);
    setDraftEditValues(buildDraftTextMap(nextHighlights));
    setIsSavingDraft(true);
    setDraftErrorMessage(null);
    try {
      const savedDraft = await onSaveNoteDraft(sourceUrl, nextDraft);
      setDraftHighlights(savedDraft.highlights);
      const savedEditValues = buildDraftTextMap(savedDraft.highlights);
      setDraftEditValues(savedEditValues);
      lastSavedTextRef.current = savedEditValues;
      setDraftMessage(successMessage);
      window.setTimeout(() => setDraftMessage(null), 1800);
      if (addedHighlightId) {
        setRecentlyAddedHighlightId(addedHighlightId);
        window.setTimeout(() => setRecentlyAddedHighlightId(null), 2200);
      }
    } catch (error) {
      setDraftHighlights(previousHighlights);
      setDraftEditValues(previousEditValues);
      setDraftErrorMessage(getNoteErrorMessage(error, "save"));
    } finally {
      setIsSavingDraft(false);
    }
  };

  const saveEditedHighlight = async (highlightId: string, text: string) => {
    if (!sourceUrl) {
      setDraftErrorMessage("当前内容没有可保存的源链接。");
      return;
    }

    const trimmedText = text.trim();
    if (
      !trimmedText ||
      trimmedText === (lastSavedTextRef.current[highlightId] ?? "").trim()
    ) {
      return;
    }

    const revision = editRevisionRef.current[highlightId] ?? 0;
    const nextHighlights = draftHighlightsRef.current.map((highlight) =>
      highlight.id === highlightId ? { ...highlight, text: trimmedText } : highlight
    );

    setDraftEditStatuses((currentStatuses) => ({
      ...currentStatuses,
      [highlightId]: "saving"
    }));
    setDraftErrorMessage(null);

    try {
      const savedDraft = await onSaveNoteDraft(sourceUrl, {
        highlights: nextHighlights,
        updated_at: new Date().toISOString()
      });
      if ((editRevisionRef.current[highlightId] ?? 0) !== revision) {
        return;
      }

      setDraftHighlights(savedDraft.highlights);
      const savedEditValues = buildDraftTextMap(savedDraft.highlights);
      setDraftEditValues(savedEditValues);
      lastSavedTextRef.current = savedEditValues;
      setDraftEditStatuses((currentStatuses) => ({
        ...currentStatuses,
        [highlightId]: "saved"
      }));
      if (editStatusTimeoutsRef.current[highlightId]) {
        window.clearTimeout(editStatusTimeoutsRef.current[highlightId]);
      }
      editStatusTimeoutsRef.current[highlightId] = window.setTimeout(() => {
        setDraftEditStatuses((currentStatuses) => {
          const { [highlightId]: _, ...nextStatuses } = currentStatuses;
          return nextStatuses;
        });
      }, EDIT_SAVED_MESSAGE_MS);
    } catch (error) {
      setDraftEditStatuses((currentStatuses) => ({
        ...currentStatuses,
        [highlightId]: "error"
      }));
      setDraftErrorMessage(getNoteErrorMessage(error, "save"));
    }
  };

  const handleDraftTextChange = (highlightId: string, text: string) => {
    editRevisionRef.current[highlightId] =
      (editRevisionRef.current[highlightId] ?? 0) + 1;
    setDraftEditValues((currentValues) => ({
      ...currentValues,
      [highlightId]: text
    }));
    setDraftHighlights((currentHighlights) =>
      currentHighlights.map((highlight) =>
        highlight.id === highlightId ? { ...highlight, text } : highlight
      )
    );
    setDraftEditStatuses((currentStatuses) => {
      const { [highlightId]: _, ...nextStatuses } = currentStatuses;
      return nextStatuses;
    });

    if (editSaveTimeoutsRef.current[highlightId]) {
      window.clearTimeout(editSaveTimeoutsRef.current[highlightId]);
    }
    if (!text.trim()) {
      return;
    }

    editSaveTimeoutsRef.current[highlightId] = window.setTimeout(() => {
      void saveEditedHighlight(highlightId, text);
    }, EDIT_SAVE_DEBOUNCE_MS);
  };

  const handleDraftTextBlur = (highlightId: string) => {
    if (editSaveTimeoutsRef.current[highlightId]) {
      window.clearTimeout(editSaveTimeoutsRef.current[highlightId]);
    }

    const currentText = draftEditValues[highlightId] ?? "";
    if (!currentText.trim()) {
      const fallbackText = lastSavedTextRef.current[highlightId] ?? "";
      setDraftEditValues((currentValues) => ({
        ...currentValues,
        [highlightId]: fallbackText
      }));
      setDraftHighlights((currentHighlights) =>
        currentHighlights.map((highlight) =>
          highlight.id === highlightId
            ? { ...highlight, text: fallbackText }
            : highlight
        )
      );
      setDraftErrorMessage("摘录不能为空，可继续编辑或移出。");
      return;
    }
    if (
      currentText.trim() === (lastSavedTextRef.current[highlightId] ?? "").trim()
    ) {
      return;
    }

    void saveEditedHighlight(highlightId, currentText);
  };

  const handleAddCandidate = async (highlight: SummaryHighlight) => {
    const nextHighlight = normalizeCandidateHighlight(highlight, textSourceType);
    if (savedHighlightIdentities.has(getHighlightIdentity(nextHighlight))) {
      setDraftMessage("这条摘录已经在草稿中。");
      window.setTimeout(() => setDraftMessage(null), 1600);
      return;
    }

    await persistDraft(
      [...draftHighlights, nextHighlight],
      "已加入摘录草稿。",
      nextHighlight.id
    );
  };

  const handleAddSelectedExcerpt = async () => {
    const excerpt = readSelectedExcerpt() ?? selectedExcerpt;
    if (!excerpt) {
      setDraftErrorMessage("请先在正文中选中要加入摘录的文字。");
      return;
    }

    const nextHighlight = buildManualHighlightFromExcerpt(excerpt, textSourceType);
    await persistDraft(
      [...draftHighlights, nextHighlight],
      "手动摘录已保存。",
      nextHighlight.id
    );
    window.getSelection()?.removeAllRanges();
    setSelectedExcerpt(null);
  };

  const handleRemoveHighlight = async (highlightId: string) => {
    await persistDraft(
      draftHighlights.filter((highlight) => highlight.id !== highlightId),
      "摘录已移出草稿。"
    );
  };

  const handleExportObsidianNote = async () => {
    if (!sourceUrl) {
      setDraftErrorMessage("当前内容没有可导出的源链接。");
      return;
    }

    setIsExportingNote(true);
    setDraftErrorMessage(null);
    try {
      const response = await apiClient.exportObsidianNote({ source_url: sourceUrl });
      if (!response.written_to_vault) {
        downloadTextFile(
          response.filename,
          response.markdown,
          "text/markdown;charset=utf-8"
        );
      }
      setDraftMessage(
        response.written_to_vault ? response.message : "已生成 Markdown 知识草稿。"
      );
      window.setTimeout(() => setDraftMessage(null), 2200);
    } catch (error) {
      setDraftErrorMessage(getNoteErrorMessage(error, "export"));
    } finally {
      setIsExportingNote(false);
    }
  };

  return {
    candidateHighlights,
    draftEditStatuses,
    draftEditValues,
    draftErrorMessage,
    draftHighlights,
    draftMessage,
    handleAddCandidate,
    handleAddSelectedExcerpt,
    handleDraftTextBlur,
    handleDraftTextChange,
    handleExcerptPointerDown,
    handleExcerptPointerUp,
    handleExportObsidianNote,
    handleRemoveHighlight,
    isExportingNote,
    isSavingDraft,
    recentlyAddedHighlightId,
    savedHighlightIdentities,
    selectedExcerpt,
    transcriptTextRootRef
  };
}
