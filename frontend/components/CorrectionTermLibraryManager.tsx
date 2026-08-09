"use client";

import type { ReactNode } from "react";
import {
  Check,
  Clock3,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingUp
} from "lucide-react";
import {
  invertCorrectionTermSelection,
  isCorrectionTermSelected,
  mergeCorrectionTerms
} from "@/lib/correction-terms";
import { useCorrectionTermLibraryManager } from "@/hooks/use-correction-term-library-manager";
import type { CorrectionTermLibraryResponse } from "@/lib/types";

interface CorrectionTermLibraryManagerProps {
  isLoading: boolean;
  library: CorrectionTermLibraryResponse | null;
  libraryError: string | null;
  selectedTerms: string[];
  onChange: (terms: string[]) => void;
  onReload: () => Promise<void>;
}

export function CorrectionTermLibraryManager({
  isLoading,
  library,
  libraryError,
  selectedTerms,
  onChange,
  onReload
}: CorrectionTermLibraryManagerProps) {
  const {
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
  } = useCorrectionTermLibraryManager({
    library,
    selectedTerms,
    onChange,
    onReload
  });

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载术语库
      </div>
    );
  }

  if (libraryError) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-[var(--muted)]">
        <p>{libraryError}</p>
        <button
          className="rounded-[2px] border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)]"
          type="button"
          onClick={() => void onReload()}
        >
          重新加载
        </button>
      </div>
    );
  }

  const deletionTitle =
    pendingDeletion?.kind === "folder"
      ? `删除文件夹“${pendingDeletion.folder.name}”？`
      : `删除选中的 ${pendingDeletion?.terms.length ?? 0} 个术语？`;
  const deletionDescription =
    pendingDeletion?.kind === "folder"
      ? "文件夹会被删除，其中的术语会保留并移到“未分类”。"
      : "所选术语会从术语库和本期选择中移除，此操作无法撤销。";

  return (
    <>
      {pendingDeletion ? (
        <div
          aria-live="assertive"
          className="border-b-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-3"
        >
          <p className="text-sm font-semibold text-[#6b3f1a]">{deletionTitle}</p>
          <p className="mt-1 text-xs leading-5 text-[#7a4a1f]">
            {deletionDescription}
          </p>
          {feedback ? (
            <p className="mt-2 text-xs leading-5 text-[#7a4a1f]">{feedback}</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              className="h-8 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 text-xs font-medium text-[var(--ink-soft)] disabled:opacity-50"
              disabled={isMutating}
              ref={cancelDeletionRef}
              type="button"
              onClick={() => {
                setPendingDeletion(null);
                setFeedback(null);
              }}
            >
              取消
            </button>
            <button
              className="h-8 rounded-[2px] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--paper)] disabled:opacity-50"
              disabled={isMutating}
              type="button"
              onClick={() => void handleConfirmDeletion()}
            >
              {isMutating ? "处理中…" : "确认删除"}
            </button>
          </div>
        </div>
      ) : null}

      <fieldset className="contents" disabled={pendingDeletion !== null}>
        <div className="grid min-h-[360px] md:grid-cols-[190px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--line-strong)] bg-[var(--paper)]/80 p-2.5 md:border-b-0 md:border-r">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                文件夹
              </p>
              <FolderPlus className="h-3.5 w-3.5 text-[var(--muted)]" />
            </div>
            <div className="space-y-1">
              {(library?.folders ?? []).map((folder) =>
                editingFolderId === folder.id ? (
                  <div className="flex gap-1" key={folder.id}>
                    <input
                      autoFocus
                      className="h-8 min-w-0 flex-1 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2 text-xs outline-none"
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
                      className="h-8 w-8 rounded-[2px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                      type="button"
                      onClick={() => void handleRenameFolder(folder)}
                    >
                      <Check className="mx-auto h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="group flex items-center gap-1" key={folder.id}>
                    <button
                      className={`min-w-0 flex-1 truncate rounded-[2px] px-2 py-2 text-left text-xs font-medium transition ${
                        activeView === `folder:${folder.id}`
                          ? "bg-[var(--ink)] text-[var(--paper)]"
                          : "text-[var(--muted-strong)] hover:bg-[var(--paper-raised)] hover:text-[var(--ink)]"
                      }`}
                      type="button"
                      onClick={() => setActiveView(`folder:${folder.id}`)}
                    >
                      {folder.name}
                    </button>
                    <button
                      aria-label={`重命名文件夹：${folder.name}`}
                      className="hidden h-7 w-7 rounded-[2px] text-[var(--muted)] hover:bg-[var(--paper-raised)] hover:text-[var(--accent)] group-hover:block"
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
                      className="hidden h-7 w-7 rounded-[2px] text-[var(--muted)] hover:bg-red-50 hover:text-red-600 group-hover:block"
                      type="button"
                      onClick={() => {
                        setFeedback(null);
                        setPendingDeletion({ folder, kind: "folder" });
                      }}
                    >
                      <Trash2 className="mx-auto h-3 w-3" />
                    </button>
                  </div>
                )
              )}
            </div>
            <div className="mt-3 flex gap-1">
              <input
                className="h-8 min-w-0 flex-1 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2 text-xs outline-none focus:border-[var(--accent)]"
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
                className="h-8 w-8 rounded-[2px] bg-[var(--ink)] text-[var(--paper)] disabled:opacity-40"
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
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
                <input
                  className="h-9 w-full rounded-[2px] border border-[var(--line-strong)] pl-8 pr-3 text-xs outline-none focus:border-[var(--accent)]"
                  placeholder="搜索当前视图"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <div className="flex min-w-0 flex-1 gap-1.5">
                <input
                  className="h-9 min-w-0 flex-1 rounded-[2px] border border-[var(--line-strong)] px-2.5 text-xs outline-none focus:border-[var(--accent)]"
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
                  className="h-9 rounded-[2px] bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--paper)] disabled:opacity-40"
                  disabled={isMutating || !managerInput.trim()}
                  type="button"
                  onClick={() => void handleManagerAdd()}
                >
                  新增
                </button>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] pb-2.5">
              <button
                className="rounded-[2px] border border-[var(--line-strong)] px-2 py-1 text-[11px] font-medium text-[var(--muted-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
                className="rounded-[2px] border border-[var(--line-strong)] px-2 py-1 text-[11px] font-medium text-[var(--muted-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
              <span className="ml-auto text-[11px] text-[var(--muted)]">
                当前 {visibleTerms.length} 个 · 已选已有 {selectedLibraryTerms.length} 个
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <select
                className="h-8 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2 text-[11px] text-[var(--muted-strong)] outline-none"
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
                className="h-8 rounded-[2px] border border-[var(--line-strong)] px-2 text-[11px] font-medium text-[var(--muted-strong)] hover:border-[var(--accent)] disabled:opacity-40"
                disabled={isMutating || selectedLibraryTerms.length === 0}
                type="button"
                onClick={() => void handleMoveSelected()}
              >
                移动所选
              </button>
              <button
                className="ml-auto inline-flex h-8 items-center gap-1 rounded-[2px] border border-red-100 px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                disabled={isMutating || selectedLibraryTerms.length === 0}
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setPendingDeletion({
                    kind: "terms",
                    terms: [...selectedLibraryTerms]
                  });
                }}
              >
                <Trash2 className="h-3 w-3" /> 删除所选
              </button>
            </div>

            <div className="mt-2 max-h-56 overflow-auto rounded-[2px] border border-[var(--line)]">
              {visibleTerms.length > 0 ? (
                visibleTerms.map((term) => {
                  const selected = isCorrectionTermSelected(selectedTerms, term.text);
                  return editingTermId === term.id ? (
                    <div
                      className="flex items-center gap-2 border-b border-[var(--line)] p-2 last:border-b-0"
                      key={term.id}
                    >
                      <input
                        autoFocus
                        className="h-8 min-w-0 flex-1 rounded-[2px] border border-[var(--line-strong)] px-2 text-xs outline-none"
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
                        className="h-8 w-8 rounded-[2px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                        type="button"
                        onClick={() => void handleRenameTerm(term)}
                      >
                        <Check className="mx-auto h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`group flex items-center gap-2 border-b border-[var(--line)] px-2 py-2 last:border-b-0 ${
                        selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--paper)]"
                      }`}
                      key={term.id}
                    >
                      <button
                        aria-label={`${selected ? "取消选择" : "选择"}术语：${term.text}`}
                        aria-pressed={selected}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border transition ${
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--paper)]"
                            : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-transparent"
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
                        <span className="block truncate text-xs font-medium text-[var(--ink-soft)]">
                          {term.text}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                          {term.folder_id
                            ? folderNameById.get(term.folder_id) || "未知文件夹"
                            : "未分类"}
                          {term.usage_count > 0 ? ` · 使用 ${term.usage_count} 次` : ""}
                        </span>
                      </button>
                      <button
                        aria-label={`重命名术语：${term.text}`}
                        className="hidden h-7 w-7 rounded-[2px] text-[var(--muted)] hover:bg-[var(--paper-raised)] hover:text-[var(--accent)] group-hover:block"
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
                <div className="flex h-28 items-center justify-center text-xs text-[var(--muted)]">
                  当前视图没有术语
                </div>
              )}
            </div>

            {!pendingDeletion && feedback ? (
              <p className="mt-2 text-xs leading-5 text-[#7a4a1f]">{feedback}</p>
            ) : null}
          </div>
        </div>
      </fieldset>
    </>
  );
}

interface LibraryViewButtonProps {
  active: boolean;
  count: number;
  icon: ReactNode;
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
      className={`mb-1 flex w-full items-center gap-2 rounded-[2px] px-2 py-2 text-xs font-medium transition ${
        active
          ? "bg-[var(--ink)] text-[var(--paper)]"
          : "text-[var(--muted-strong)] hover:bg-[var(--paper-raised)] hover:text-[var(--ink)]"
      }`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="text-[var(--muted)]">{count}</span>
    </button>
  );
}
