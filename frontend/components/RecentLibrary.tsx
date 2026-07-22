import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2
} from "lucide-react";
import type {
  LibraryFilter,
  LibraryItem,
  LibraryStatsResponse
} from "@/lib/types";
import {
  formatLibraryUpdatedAt,
  getLibraryStatusLabel,
  getPlatformLabel,
  matchesLibraryFilter
} from "@/lib/library-display";
import { isPodcastMedia } from "@/lib/media";

interface RecentLibraryProps {
  activeVideoId?: string | null;
  canLoadMore: boolean;
  copiedVideoId: string | null;
  deletingVideoId: string | null;
  disabled?: boolean;
  filter: LibraryFilter;
  isClearing: boolean;
  isRefreshing: boolean;
  items: LibraryItem[];
  loadingVideoId: string | null;
  stats: LibraryStatsResponse | null;
  variant?: "home" | "workbench";
  onChangeFilter: (filter: LibraryFilter) => void;
  onClearAll: () => void;
  onCopySourceUrl: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onLoadMore: () => void;
  onOpenItem: (item: LibraryItem) => void;
  onRefresh: () => void;
}

export function RecentLibrary({
  activeVideoId = null,
  canLoadMore,
  copiedVideoId,
  deletingVideoId,
  disabled = false,
  filter,
  isClearing,
  isRefreshing,
  items,
  loadingVideoId,
  stats,
  variant = "home",
  onChangeFilter,
  onClearAll,
  onCopySourceUrl,
  onDeleteItem,
  onLoadMore,
  onOpenItem,
  onRefresh
}: RecentLibraryProps) {
  const isWorkbench = variant === "workbench";
  const visibleItems = items.filter((item) => matchesLibraryFilter(item, filter));
  const isBusy =
    loadingVideoId !== null ||
    deletingVideoId !== null ||
    isRefreshing ||
    isClearing;
  const canUseActions = !disabled && !isBusy;
  const totalItems = stats?.total_items ?? items.length;
  const itemCountLabel = totalItems > 0 ? `${totalItems} 条` : "暂无记录";
  const filterOptions: Array<{
    count: number;
    key: LibraryFilter;
    label: string;
  }> = [
    { count: items.length, key: "all", label: "全部" },
    {
      count: items.filter((item) => matchesLibraryFilter(item, "ready")).length,
      key: "ready",
      label: "可总结"
    },
    {
      count: items.filter((item) => matchesLibraryFilter(item, "summarized"))
        .length,
      key: "summarized",
      label: "已总结"
    },
    {
      count: items.filter((item) => matchesLibraryFilter(item, "noTranscript"))
        .length,
      key: "noTranscript",
      label: "需转写"
    }
  ];
  return (
    <section
      className={`mx-auto px-4 sm:px-6 ${
        isWorkbench
          ? "max-w-[90rem] pb-5 lg:px-10"
          : "max-w-[90rem] bg-[var(--paper)] py-14 lg:px-10 lg:py-20"
      }`}
    >
      <div
        className={`library-surface bg-[var(--paper-raised)] ${
          isWorkbench ? "rounded-[20px] p-3" : "rounded-[28px] p-4 sm:p-6"
        }`}
      >
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
            <div>
              <h2
                className={`${
                  isWorkbench ? "text-sm" : "font-editorial text-2xl sm:text-3xl"
                } font-semibold text-[var(--ink)]`}
              >
                {isWorkbench ? "最近档案" : "你的本地资料索引"}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs tabular-nums text-[var(--muted)]">
              本地历史 · {itemCountLabel}
            </span>
            {totalItems > 0 ? (
              <button
                aria-label="清空本地历史"
                className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--muted)] transition-[background-color,color,scale] duration-150 hover:bg-red-50 hover:text-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canUseActions}
                title="清空本地历史"
                type="button"
                onClick={onClearAll}
              >
                {isClearing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                )}
                清空
              </button>
            ) : null}
            <button
              aria-label="刷新最近解析"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--muted)] transition-[background-color,color,scale] duration-150 hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUseActions}
              title="刷新最近解析"
              type="button"
              onClick={onRefresh}
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {filterOptions.map((filterOption) => {
            const isActive = filter === filterOption.key;

            return (
              <button
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-medium tabular-nums transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? "bg-[var(--ink)] text-[var(--paper-raised)]"
                    : "bg-[var(--paper-deep)] text-[var(--muted-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                }`}
                disabled={!canUseActions}
                key={filterOption.key}
                type="button"
                onClick={() => onChangeFilter(filterOption.key)}
              >
                {filterOption.label} · {filterOption.count}
              </button>
            );
          })}
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper-deep)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            暂无本地历史记录。解析公开媒体链接后，这里会显示最近解析入口。
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper-deep)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            当前筛选下没有记录，可切换筛选或加载更多历史。
          </div>
        ) : (
          <div
            className={
              isWorkbench
                ? "flex snap-x gap-3 overflow-x-auto pb-2"
                : "grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3"
            }
          >
          {visibleItems.map((item) => {
            const isActive = activeVideoId === item.video_id;
            const isCopied = copiedVideoId === item.video_id;
            const isLoading = loadingVideoId === item.video_id;
            const isDeleting = deletingVideoId === item.video_id;
            const isDisabled = !canUseActions;

            return (
              <article
                className={`archive-row flex h-full rounded-[18px] bg-[var(--paper)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 ${
                  isWorkbench
                    ? "min-h-32 min-w-[300px] snap-start sm:min-w-[340px]"
                    : "min-h-[190px]"
                } ${
                  isActive
                    ? "shadow-[0_0_0_2px_var(--accent),var(--shadow-paper)]"
                    : ""
                }`}
                key={`${item.video_id}-${item.updated_at}`}
              >
                <button
                  className="group flex h-full flex-1 flex-col p-4 text-left transition-transform duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isDisabled}
                  type="button"
                  onClick={() => onOpenItem(item)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {isActive ? (
                        <span className="mb-1 inline-flex min-h-6 items-center rounded-full bg-[var(--accent)] px-2 text-[11px] font-medium text-white">
                          当前打开
                        </span>
                      ) : null}
                      <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--ink)]">
                        {item.title}
                      </p>
                    </div>
                    {isLoading ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <FileText
                        className="h-4 w-4 shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    <span>{item.author}</span>
                    <span>
                      {isPodcastMedia(item)
                        ? "播客音频"
                        : getPlatformLabel(item.platform)}
                    </span>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs">
                    <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 font-medium text-[var(--ink)]">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {getLibraryStatusLabel(item)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatLibraryUpdatedAt(item.updated_at)}
                    </span>
                  </div>
                </button>

                <div className="m-2 flex shrink-0 flex-col gap-1">
                  <button
                    aria-label={`复制源链接：${item.title}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--muted)] transition-[background-color,color,scale] duration-150 hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canUseActions}
                    title="复制源链接"
                    type="button"
                    onClick={() => onCopySourceUrl(item)}
                  >
                    {isCopied ? (
                      <Check
                        className="h-4 w-4 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>

                  <button
                    aria-label={`删除历史记录：${item.title}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--muted)] transition-[background-color,color,scale] duration-150 hover:bg-red-50 hover:text-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canUseActions}
                    title="删除历史记录"
                    type="button"
                    onClick={() => onDeleteItem(item)}
                  >
                    {isDeleting ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </article>
            );
          })}
          </div>
        )}

        {items.length > 0 && canLoadMore ? (
          <div className="mt-3 flex justify-center">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--paper-deep)] px-4 text-sm font-medium text-[var(--muted-strong)] transition-[background-color,color,scale] duration-150 hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUseActions}
              type="button"
              onClick={onLoadMore}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              加载更多
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
