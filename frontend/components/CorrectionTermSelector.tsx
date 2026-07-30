"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  X
} from "lucide-react";
import { apiClient } from "@/lib/api";
import {
  getFrequentCorrectionTerms,
  getRecentCorrectionTerms,
  invertCorrectionTermSelection,
  isCorrectionTermSelected,
  MAX_SELECTED_CORRECTION_TERMS,
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

interface CorrectionTermSelectorProps {
  correctionAvailable: boolean;
  correctionMessage?: string | null;
  disabled?: boolean;
  selectedTerms: string[];
  onChange: (terms: string[]) => void;
}

type LibraryView = "all" | "recent" | "frequent" | "unfiled" | `folder:${number}`;

export function CorrectionTermSelector({
  correctionAvailable,
  correctionMessage,
  disabled = false,
  selectedTerms,
  onChange
}: CorrectionTermSelectorProps) {
  const [library, setLibrary] = useState<CorrectionTermLibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [quickInput, setQuickInput] = useState("");
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

  const loadLibrary = async () => {
    setIsLoading(true);
    setLibraryError(null);
    try {
      setLibrary(await apiClient.getCorrectionTermLibrary());
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "术语库加载失败，请稍后重试。"
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

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

  const addTermsToSelection = (rawValue: string) => {
    const parsedTerms = parseCorrectionTermInput(rawValue);
    if (parsedTerms.length === 0) {
      setFeedback("请输入至少一个有效术语。");
      return false;
    }
    if (parsedTerms.some((term) => term.length > 80)) {
      setFeedback("单个术语不能超过 80 个字符。");
      return false;
    }

    const nextTerms = mergeCorrectionTerms(selectedTerms, parsedTerms);
    onChange(nextTerms);
    setFeedback(
      nextTerms.length >= MAX_SELECTED_CORRECTION_TERMS &&
        nextTerms.length < selectedTerms.length + parsedTerms.length
        ? `本期最多选择 ${MAX_SELECTED_CORRECTION_TERMS} 个术语。`
        : null
    );
    return true;
  };

  const toggleTerm = (term: string) => {
    onChange(
      isCorrectionTermSelected(selectedTerms, term)
        ? removeCorrectionTerm(selectedTerms, term)
        : mergeCorrectionTerms(selectedTerms, [term])
    );
    setSelectionAnchor(term);
  };

  const runMutation = async (mutation: () => Promise<unknown>) => {
    setIsMutating(true);
    setFeedback(null);
    try {
      await mutation();
      await loadLibrary();
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "术语库操作失败。");
      return false;
    } finally {
      setIsMutating(false);
    }
  };

  const handleQuickAdd = () => {
    if (addTermsToSelection(quickInput)) {
      setQuickInput("");
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
      addTermsToSelection(terms.join("、"));
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

  const handleDeleteFolder = async (folder: CorrectionTermFolder) => {
    if (
      !window.confirm(
        `删除文件夹“${folder.name}”？其中的术语会保留并移到“未分类”。`
      )
    ) {
      return;
    }
    const succeeded = await runMutation(() =>
      apiClient.deleteCorrectionTermFolder(folder.id)
    );
    if (succeeded && activeView === `folder:${folder.id}`) {
      setActiveView("unfiled");
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

  const handleDeleteSelected = async () => {
    if (selectedLibraryTerms.length === 0) {
      setFeedback("请先选择需要删除的已有术语。");
      return;
    }
    if (
      !window.confirm(
        `确定删除选中的 ${selectedLibraryTerms.length} 个术语？此操作无法撤销。`
      )
    ) {
      return;
    }
    const deletedTexts = selectedLibraryTerms.map((term) => term.text);
    const succeeded = await runMutation(() =>
      apiClient.deleteCorrectionTerms(selectedLibraryTerms.map((term) => term.id))
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
    }
  };

  const handleRowSelection = (
    event: React.MouseEvent<HTMLButtonElement>,
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
    toggleTerm(term.text);
  };

  const selectedPreview = selectedTerms.slice(0, 10);

  return (
    <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/45 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-800">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            AI 校对术语
            <span className="font-normal text-zinc-400">可选</span>
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            填写容易写错的专有名词，仅在语音识别完成后用于 AI 校对，不改变原始识别稿。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100">
          已选 {selectedTerms.length}/{MAX_SELECTED_CORRECTION_TERMS}
        </span>
      </div>

      {!correctionAvailable ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {correctionMessage || "AI 校对当前不可用，所选术语不会应用到终稿。"}
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          className="h-10 min-w-0 flex-1 rounded-lg border border-blue-100 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-zinc-100"
          disabled={disabled}
          maxLength={2000}
          placeholder="输入人名、品牌或英文术语，支持逗号、顿号、换行"
          value={quickInput}
          onChange={(event) => setQuickInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              handleQuickAdd();
            }
          }}
        />
        <button
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !quickInput.trim()}
          type="button"
          onClick={handleQuickAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          加入本期
        </button>
      </div>

      {recentTerms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
            <Clock3 className="h-3 w-3" /> 最近
          </span>
          {recentTerms.map((term) => {
            const selected = isCorrectionTermSelected(selectedTerms, term.text);
            return (
              <button
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  selected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-blue-100 bg-white text-zinc-600 hover:border-blue-300"
                }`}
                disabled={disabled}
                key={term.id}
                type="button"
                onClick={() => toggleTerm(term.text)}
              >
                {term.text}
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedTerms.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedPreview.map((term) => (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-blue-100"
              key={term}
            >
              {term}
              <button
                aria-label={`移除术语：${term}`}
                className="text-zinc-400 transition hover:text-red-600"
                disabled={disabled}
                type="button"
                onClick={() => onChange(removeCorrectionTerm(selectedTerms, term))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedTerms.length > selectedPreview.length ? (
            <span className="px-1 py-1 text-xs text-zinc-500">
              另有 {selectedTerms.length - selectedPreview.length} 个
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">本期未选择术语，系统不会使用隐藏术语。</p>
      )}

      <button
        className="flex w-full items-center justify-between rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-700"
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span>管理与选择术语库</span>
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {isExpanded ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载术语库
            </div>
          ) : libraryError ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-zinc-500">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <p>{libraryError}</p>
              <button
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700"
                type="button"
                onClick={() => void loadLibrary()}
              >
                重新加载
              </button>
            </div>
          ) : (
            <div className="grid min-h-[360px] md:grid-cols-[190px_minmax(0,1fr)]">
              <aside className="border-b border-zinc-200 bg-zinc-50/80 p-2.5 md:border-b-0 md:border-r">
                <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  智能视图
                </p>
                <LibraryViewButton
                  active={activeView === "all"}
                  count={library?.terms.length ?? 0}
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  label="全部术语"
                  onClick={() => setActiveView("all")}
                />
                <LibraryViewButton
                  active={activeView === "recent"}
                  count={recentTerms.length}
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                  label="最近使用"
                  onClick={() => setActiveView("recent")}
                />
                <LibraryViewButton
                  active={activeView === "frequent"}
                  count={frequentTerms.length}
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label="常用术语"
                  onClick={() => setActiveView("frequent")}
                />
                <LibraryViewButton
                  active={activeView === "unfiled"}
                  count={(library?.terms ?? []).filter((term) => term.folder_id == null).length}
                  icon={<Folder className="h-3.5 w-3.5" />}
                  label="未分类"
                  onClick={() => setActiveView("unfiled")}
                />

                <div className="mt-4 flex items-center justify-between px-2 pb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                    文件夹
                  </p>
                  <FolderPlus className="h-3.5 w-3.5 text-zinc-400" />
                </div>
                <div className="space-y-1">
                  {(library?.folders ?? []).map((folder) =>
                    editingFolderId === folder.id ? (
                      <div className="flex gap-1" key={folder.id}>
                        <input
                          autoFocus
                          className="h-8 min-w-0 flex-1 rounded-md border border-blue-300 bg-white px-2 text-xs outline-none"
                          maxLength={60}
                          value={editingFolderName}
                          onChange={(event) => setEditingFolderName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRenameFolder(folder);
                            if (event.key === "Escape") setEditingFolderId(null);
                          }}
                        />
                        <button
                          aria-label={`保存文件夹名称：${editingFolderName}`}
                          className="h-8 w-8 rounded-md text-blue-600 hover:bg-blue-50"
                          type="button"
                          onClick={() => void handleRenameFolder(folder)}
                        >
                          <Check className="mx-auto h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="group flex items-center gap-1" key={folder.id}>
                        <button
                          className={`min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left text-xs font-medium transition ${
                            activeView === `folder:${folder.id}`
                              ? "bg-zinc-900 text-white"
                              : "text-zinc-600 hover:bg-white hover:text-zinc-950"
                          }`}
                          type="button"
                          onClick={() => setActiveView(`folder:${folder.id}`)}
                        >
                          {folder.name}
                        </button>
                        <button
                          aria-label={`重命名文件夹：${folder.name}`}
                          className="hidden h-7 w-7 rounded text-zinc-400 hover:bg-white hover:text-blue-600 group-hover:block"
                          type="button"
                          onClick={() => {
                            setEditingFolderId(folder.id);
                            setEditingFolderName(folder.name);
                          }}
                        >
                          <Pencil className="mx-auto h-3 w-3" />
                        </button>
                        <button
                          aria-label={`删除文件夹：${folder.name}`}
                          className="hidden h-7 w-7 rounded text-zinc-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
                          type="button"
                          onClick={() => void handleDeleteFolder(folder)}
                        >
                          <Trash2 className="mx-auto h-3 w-3" />
                        </button>
                      </div>
                    )
                  )}
                </div>
                <div className="mt-3 flex gap-1">
                  <input
                    className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-blue-400"
                    maxLength={60}
                    placeholder="新建文件夹"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleCreateFolder();
                    }}
                  />
                  <button
                    aria-label="创建文件夹"
                    className="h-8 w-8 rounded-md bg-zinc-900 text-white disabled:opacity-40"
                    disabled={isMutating || !newFolderName.trim()}
                    type="button"
                    onClick={() => void handleCreateFolder()}
                  >
                    <Plus className="mx-auto h-3.5 w-3.5" />
                  </button>
                </div>
              </aside>

              <div className="min-w-0 p-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                    <input
                      className="h-9 w-full rounded-lg border border-zinc-200 pl-8 pr-3 text-xs outline-none focus:border-blue-400"
                      placeholder="搜索当前视图"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 gap-1.5">
                    <input
                      className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 px-2.5 text-xs outline-none focus:border-blue-400"
                      placeholder={
                        activeView.startsWith("folder:")
                          ? "新增到当前文件夹"
                          : "新增到未分类"
                      }
                      value={managerInput}
                      onChange={(event) => setManagerInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void handleManagerAdd();
                        }
                      }}
                    />
                    <button
                      className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-40"
                      disabled={isMutating || !managerInput.trim()}
                      type="button"
                      onClick={() => void handleManagerAdd()}
                    >
                      新增
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-b border-zinc-100 pb-2.5">
                  <button
                    className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-700"
                    type="button"
                    onClick={() =>
                      onChange(
                        mergeCorrectionTerms(
                          selectedTerms,
                          visibleTerms.map((term) => term.text)
                        )
                      )
                    }
                  >
                    全选当前
                  </button>
                  <button
                    className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-700"
                    type="button"
                    onClick={() =>
                      onChange(
                        invertCorrectionTermSelection(
                          selectedTerms,
                          visibleTerms.map((term) => term.text)
                        )
                      )
                    }
                  >
                    反选当前
                  </button>
                  <span className="ml-auto text-[11px] text-zinc-400">
                    当前 {visibleTerms.length} 个 · 已选已有 {selectedLibraryTerms.length} 个
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <select
                    className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600 outline-none"
                    value={moveFolderId}
                    onChange={(event) => setMoveFolderId(event.target.value)}
                  >
                    <option value="unfiled">移动到：未分类</option>
                    {(library?.folders ?? []).map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        移动到：{folder.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="h-8 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-600 hover:border-blue-300 disabled:opacity-40"
                    disabled={isMutating || selectedLibraryTerms.length === 0}
                    type="button"
                    onClick={() => void handleMoveSelected()}
                  >
                    移动所选
                  </button>
                  <button
                    className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-red-100 px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                    disabled={isMutating || selectedLibraryTerms.length === 0}
                    type="button"
                    onClick={() => void handleDeleteSelected()}
                  >
                    <Trash2 className="h-3 w-3" /> 删除所选
                  </button>
                </div>

                <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-zinc-100">
                  {visibleTerms.length > 0 ? (
                    visibleTerms.map((term) => {
                      const selected = isCorrectionTermSelected(selectedTerms, term.text);
                      return editingTermId === term.id ? (
                        <div
                          className="flex items-center gap-2 border-b border-zinc-100 p-2 last:border-b-0"
                          key={term.id}
                        >
                          <input
                            autoFocus
                            className="h-8 min-w-0 flex-1 rounded-md border border-blue-300 px-2 text-xs outline-none"
                            maxLength={80}
                            value={editingTermText}
                            onChange={(event) => setEditingTermText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void handleRenameTerm(term);
                              if (event.key === "Escape") setEditingTermId(null);
                            }}
                          />
                          <button
                            aria-label={`保存术语名称：${editingTermText}`}
                            className="h-8 w-8 rounded-md text-blue-600 hover:bg-blue-50"
                            type="button"
                            onClick={() => void handleRenameTerm(term)}
                          >
                            <Check className="mx-auto h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`group flex items-center gap-2 border-b border-zinc-100 px-2 py-2 last:border-b-0 ${
                            selected ? "bg-blue-50" : "hover:bg-zinc-50"
                          }`}
                          key={term.id}
                        >
                          <button
                            aria-label={`${selected ? "取消选择" : "选择"}术语：${term.text}`}
                            aria-pressed={selected}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                              selected
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-zinc-300 bg-white text-transparent"
                            }`}
                            type="button"
                            onClick={(event) => handleRowSelection(event, term)}
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            className="min-w-0 flex-1 text-left"
                            type="button"
                            onClick={(event) => handleRowSelection(event, term)}
                          >
                            <span className="block truncate text-xs font-medium text-zinc-800">
                              {term.text}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-zinc-400">
                              {term.folder_id
                                ? folderNameById.get(term.folder_id) || "未知文件夹"
                                : "未分类"}
                              {term.usage_count > 0 ? ` · 使用 ${term.usage_count} 次` : ""}
                            </span>
                          </button>
                          <button
                            aria-label={`重命名术语：${term.text}`}
                            className="hidden h-7 w-7 rounded text-zinc-400 hover:bg-white hover:text-blue-600 group-hover:block"
                            type="button"
                            onClick={() => {
                              setEditingTermId(term.id);
                              setEditingTermText(term.text);
                            }}
                          >
                            <Pencil className="mx-auto h-3 w-3" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex h-28 items-center justify-center text-xs text-zinc-400">
                      当前视图没有术语
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {feedback ? <p className="text-xs leading-5 text-amber-700">{feedback}</p> : null}
    </section>
  );
}

interface LibraryViewButtonProps {
  active: boolean;
  count: number;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function LibraryViewButton({
  active,
  count,
  icon,
  label,
  onClick
}: LibraryViewButtonProps) {
  return (
    <button
      className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium transition ${
        active
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:bg-white hover:text-zinc-950"
      }`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className={active ? "text-zinc-300" : "text-zinc-400"}>{count}</span>
    </button>
  );
}
