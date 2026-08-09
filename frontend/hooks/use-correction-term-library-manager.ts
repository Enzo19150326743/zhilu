"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { apiClient } from "@/lib/api";
import {
  getFrequentCorrectionTerms,
  getRecentCorrectionTerms,
  isCorrectionTermSelected,
  mergeCorrectionTerms,
  parseCorrectionTermInput,
  removeCorrectionTerm,
  selectCorrectionTermRange
} from "@/lib/correction-terms";
import type {
  CorrectionTermFolder,
  CorrectionTermItem,
  CorrectionTermLibraryResponse
} from "@/lib/types";

type LibraryView = "all" | "recent" | "frequent" | "unfiled" | `folder:${number}`;
type PendingDeletion =
  | { folder: CorrectionTermFolder; kind: "folder" }
  | { kind: "terms"; terms: CorrectionTermItem[] };

interface UseCorrectionTermLibraryManagerOptions {
  library: CorrectionTermLibraryResponse | null;
  selectedTerms: string[];
  onChange: (terms: string[]) => void;
  onReload: () => Promise<void>;
}

export function useCorrectionTermLibraryManager({
  library,
  selectedTerms,
  onChange,
  onReload
}: UseCorrectionTermLibraryManagerOptions) {
  const [isMutating, setIsMutating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [managerInput, setManagerInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<LibraryView>("recent");
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [editingTermId, setEditingTermId] = useState<number | null>(null);
  const [editingTermText, setEditingTermText] = useState("");
  const [moveFolderId, setMoveFolderId] = useState<string>("unfiled");
  const [pendingDeletion, setPendingDeletion] =
    useState<PendingDeletion | null>(null);
  const cancelDeletionRef = useRef<HTMLButtonElement>(null);

  const recentTerms = useMemo(
    () => getRecentCorrectionTerms(library?.terms ?? []),
    [library]
  );
  const frequentTerms = useMemo(
    () => getFrequentCorrectionTerms(library?.terms ?? []),
    [library]
  );
  const folderNameById = useMemo(
    () =>
      new Map((library?.folders ?? []).map((folder) => [folder.id, folder.name])),
    [library]
  );
  const visibleTerms = useMemo(() => {
    const allTerms = library?.terms ?? [];
    let viewTerms: CorrectionTermItem[];
    if (activeView === "recent") {
      viewTerms = getRecentCorrectionTerms(allTerms, allTerms.length);
    } else if (activeView === "frequent") {
      viewTerms = getFrequentCorrectionTerms(allTerms);
    } else if (activeView === "unfiled") {
      viewTerms = allTerms.filter((term) => term.folder_id == null);
    } else if (activeView.startsWith("folder:")) {
      const folderId = Number(activeView.slice("folder:".length));
      viewTerms = allTerms.filter((term) => term.folder_id === folderId);
    } else {
      viewTerms = allTerms;
    }

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return viewTerms;
    }
    return viewTerms.filter((term) =>
      term.text.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [activeView, library, searchQuery]);
  const selectedLibraryTerms = useMemo(
    () =>
      (library?.terms ?? []).filter((term) =>
        isCorrectionTermSelected(selectedTerms, term.text)
      ),
    [library, selectedTerms]
  );

  useEffect(() => {
    if (pendingDeletion) {
      cancelDeletionRef.current?.focus();
    }
  }, [pendingDeletion]);

  const runMutation = async (mutation: () => Promise<unknown>) => {
    setIsMutating(true);
    setFeedback(null);
    try {
      await mutation();
      await onReload();
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "术语库操作失败。");
      return false;
    } finally {
      setIsMutating(false);
    }
  };

  const handleManagerAdd = async () => {
    const terms = parseCorrectionTermInput(managerInput);
    if (terms.length === 0 || terms.some((term) => term.length > 80)) {
      setFeedback(
        terms.length === 0 ? "请输入至少一个有效术语。" : "单个术语不能超过 80 个字符。"
      );
      return;
    }
    const targetFolderId = activeView.startsWith("folder:")
      ? Number(activeView.slice("folder:".length))
      : null;
    const succeeded = await runMutation(() =>
      apiClient.createCorrectionTerms(terms, targetFolderId)
    );
    if (succeeded) {
      onChange(mergeCorrectionTerms(selectedTerms, terms));
      setManagerInput("");
    }
  };

  const handleCreateFolder = async () => {
    const folderName = newFolderName.trim();
    if (!folderName) {
      setFeedback("请输入文件夹名称。");
      return;
    }
    const succeeded = await runMutation(() =>
      apiClient.createCorrectionTermFolder(folderName)
    );
    if (succeeded) {
      setNewFolderName("");
    }
  };

  const handleRenameFolder = async (folder: CorrectionTermFolder) => {
    const folderName = editingFolderName.trim();
    if (!folderName) {
      setFeedback("文件夹名称不能为空。");
      return;
    }
    const succeeded = await runMutation(() =>
      apiClient.renameCorrectionTermFolder(folder.id, folderName)
    );
    if (succeeded) {
      setEditingFolderId(null);
      setEditingFolderName("");
    }
  };

  const handleRenameTerm = async (term: CorrectionTermItem) => {
    const termText = editingTermText.trim();
    if (!termText) {
      setFeedback("术语不能为空。");
      return;
    }
    const succeeded = await runMutation(() =>
      apiClient.renameCorrectionTerm(term.id, termText)
    );
    if (succeeded) {
      onChange(
        mergeCorrectionTerms(
          removeCorrectionTerm(selectedTerms, term.text),
          isCorrectionTermSelected(selectedTerms, term.text) ? [termText] : []
        )
      );
      setEditingTermId(null);
      setEditingTermText("");
    }
  };

  const handleMoveSelected = async () => {
    if (selectedLibraryTerms.length === 0) {
      setFeedback("请先选择需要移动的已有术语。");
      return;
    }
    const targetFolderId = moveFolderId === "unfiled" ? null : Number(moveFolderId);
    await runMutation(() =>
      apiClient.moveCorrectionTerms(
        selectedLibraryTerms.map((term) => term.id),
        targetFolderId
      )
    );
  };

  const handleConfirmDeletion = async () => {
    if (!pendingDeletion) {
      return;
    }

    if (pendingDeletion.kind === "folder") {
      const { folder } = pendingDeletion;
      const succeeded = await runMutation(() =>
        apiClient.deleteCorrectionTermFolder(folder.id)
      );
      if (succeeded) {
        if (activeView === `folder:${folder.id}`) {
          setActiveView("unfiled");
        }
        setPendingDeletion(null);
      }
      return;
    }

    const deletedTexts = pendingDeletion.terms.map((term) => term.text);
    const succeeded = await runMutation(() =>
      apiClient.deleteCorrectionTerms(pendingDeletion.terms.map((term) => term.id))
    );
    if (succeeded) {
      onChange(
        selectedTerms.filter(
          (selectedTerm) =>
            !deletedTexts.some((deletedText) =>
              isCorrectionTermSelected([deletedText], selectedTerm)
            )
        )
      );
      setPendingDeletion(null);
    }
  };

  const handleRowSelection = (
    event: MouseEvent<HTMLButtonElement>,
    term: CorrectionTermItem
  ) => {
    if (event.shiftKey) {
      onChange(
        selectCorrectionTermRange(
          selectedTerms,
          visibleTerms.map((item) => item.text),
          selectionAnchor,
          term.text,
          event.ctrlKey || event.metaKey
        )
      );
      setSelectionAnchor(term.text);
      return;
    }

    onChange(
      isCorrectionTermSelected(selectedTerms, term.text)
        ? removeCorrectionTerm(selectedTerms, term.text)
        : mergeCorrectionTerms(selectedTerms, [term.text])
    );
    setSelectionAnchor(term.text);
  };

  return {
    activeView,
    cancelDeletionRef,
    editingFolderId,
    editingFolderName,
    editingTermId,
    editingTermText,
    feedback,
    folderNameById,
    frequentTerms,
    handleConfirmDeletion,
    handleCreateFolder,
    handleManagerAdd,
    handleMoveSelected,
    handleRenameFolder,
    handleRenameTerm,
    handleRowSelection,
    isMutating,
    managerInput,
    moveFolderId,
    newFolderName,
    pendingDeletion,
    recentTerms,
    searchQuery,
    selectedLibraryTerms,
    setActiveView,
    setEditingFolderId,
    setEditingFolderName,
    setEditingTermId,
    setEditingTermText,
    setFeedback,
    setManagerInput,
    setMoveFolderId,
    setNewFolderName,
    setPendingDeletion,
    setSearchQuery,
    visibleTerms
  };
}
