import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  RefreshCw,
  Trash2
} from "lucide-react";
import { ActionMenu } from "./ActionMenu";
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
  isLoading: boolean;
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
  isLoading,
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
    isLoading ||
    isRefreshing ||
    isClearing;
  const canUseActions = !disabled && !isBusy;
  const totalItems = stats?.total_items ?? items.length;
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
      className={`mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10 ${
        isWorkbench ? "pb-10" : "bg-[var(--paper)] pb-20 pt-4"
      }`}
    >
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2
            className={`font-editorial font-bold text-[var(--ink)] ${
              isWorkbench ? "text-xl" : "text-[28px]"
            }`}
          >
            最近档案
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {totalItems > 0 ? (
            <ActionMenu
              disabled={!canUseActions}
              items={[
                {
                  destructive: true,
                  icon: Trash2,
                  label: "清空全部记录",
                  onSelect: onClearAll
                }
              ]}
              label="管理最近档案"
            />
          ) : null}
          <button
            aria-label="刷新最近解析"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] text-[var(--ink)] shadow-[2px_2px_0_0_var(--ink)] transition-[box-shadow,transform] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            data-dialog-return-focus-fallback
            disabled={!canUseActions}
            title="刷新最近解析"
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {!isLoading ? (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {filterOptions.map((filterOption) => {
            const isActive = filter === filterOption.key;

            return (
              <button
                className={`inline-flex min-h-9 shrink-0 items-center rounded-[2px] border-2 border-[var(--line-ink)] px-3 text-xs tabular-nums transition-[background-color,color,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? "bg-[var(--ink)] font-semibold text-[var(--paper-raised)] shadow-[2px_2px_0_0_var(--accent)]"
                    : "bg-[var(--paper-raised)] font-normal text-[var(--ink-soft)] hover:bg-[var(--accent-soft)]"
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
      ) : null}

      {isLoading ? (
        <div aria-live="polite" aria-label="正在加载最近档案" role="status">
          <span className="sr-only">正在加载最近档案</span>
          <div className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-4 border-y-2 border-[var(--line-ink)] py-2.5 sm:grid-cols-[112px_minmax(0,1fr)_112px_112px_96px_48px]">
            {["作者", "标题", "来源", "状态", "时间", "操作"].map(
              (label, index) => (
                <span
                  className={`mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] ${
                    index === 0 || (index >= 2 && index <= 4)
                      ? "hidden sm:block"
                      : ""
                  }`}
                  key={label}
                >
                  {label}
                </span>
              )
            )}
          </div>
          <div className="divide-y divide-[var(--line-ink)]/60">
            {[0, 1, 2].map((rowIndex) => (
              <div
                className="grid h-14 grid-cols-[minmax(0,1fr)_48px] items-center gap-4 sm:grid-cols-[112px_minmax(0,1fr)_112px_112px_96px_48px]"
                key={rowIndex}
              >
                <span className="hidden h-3 w-16 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="h-3 w-3/4 animate-pulse bg-[var(--paper-deep)]" />
                <span className="hidden h-3 w-20 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="hidden h-3 w-14 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="hidden h-3 w-16 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="h-8 w-8 animate-pulse bg-[var(--paper-deep)]" />
              </div>
            ))}
          </div>
          <div className="border-t-2 border-[var(--line-ink)]" aria-hidden="true" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[2px] border-2 border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          暂无本地历史记录。解析公开媒体链接后，这里会显示最近解析入口。
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-[2px] border-2 border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          当前筛选下没有记录，可切换筛选或加载更多历史。
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-4 border-y-2 border-[var(--line-ink)] py-2.5 sm:grid-cols-[112px_minmax(0,1fr)_112px_112px_96px_48px]">
            <span className="mono hidden text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] sm:block">
              作者
            </span>
            <span className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              标题
            </span>
            <span className="mono hidden text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] sm:block">
              来源
            </span>
            <span className="mono hidden text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] sm:block">
              状态
            </span>
            <span className="mono hidden text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] sm:block">
              时间
            </span>
            <span className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              操作
            </span>
          </div>

          <div className="divide-y divide-[var(--line-ink)]/60">
            {visibleItems.map((item) => {
              const isActive = activeVideoId === item.video_id;
              const isCopied = copiedVideoId === item.video_id;
              const isLoading = loadingVideoId === item.video_id;
              const isDeleting = deletingVideoId === item.video_id;
              const isDisabled = !canUseActions;

              return (
                <div
                  className={`group grid grid-cols-[minmax(0,1fr)_48px] items-center gap-4 py-3 sm:h-14 sm:grid-cols-[112px_minmax(0,1fr)_112px_112px_96px_48px] sm:py-0 ${
                    isActive
                      ? "bg-[var(--accent-soft)]/60 shadow-[inset_4px_0_0_0_var(--accent)]"
                      : ""
                  }`}
                  key={`${item.video_id}-${item.updated_at}`}
                >
                  <span className="hidden truncate text-[11px] text-[var(--muted)] sm:block">
                    {item.author}
                  </span>
                  <button
                    className="min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isDisabled}
                    type="button"
                    onClick={() => onOpenItem(item)}
                  >
                    <span className="font-editorial block truncate text-sm font-semibold leading-6 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)] sm:hidden">
                      {item.author} · {getLibraryStatusLabel(item)}
                    </span>
                  </button>
                  <span className="hidden truncate text-[11px] text-[var(--muted)] sm:block">
                    {isPodcastMedia(item)
                      ? "小宇宙 · 播客"
                      : `${getPlatformLabel(item.platform)} · 视频`}
                  </span>
                  <span className="hidden truncate text-xs text-[var(--ink-soft)] sm:block">
                    {isLoading ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-[var(--accent)]"
                        aria-hidden="true"
                      />
                    ) : (
                      getLibraryStatusLabel(item)
                    )}
                  </span>
                  <span className="hidden truncate text-[11px] text-[var(--muted)] sm:block">
                    {formatLibraryUpdatedAt(item.updated_at)}
                  </span>
                  <ActionMenu
                    disabled={!canUseActions || isDeleting}
                    items={[
                      {
                        icon: isCopied ? Check : Copy,
                        label: isCopied ? "已复制源链接" : "复制源链接",
                        onSelect: () => onCopySourceUrl(item)
                      },
                      {
                        destructive: true,
                        icon: Trash2,
                        label: "删除记录",
                        onSelect: () => onDeleteItem(item)
                      }
                    ]}
                    label={`管理记录：${item.title}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="border-t-2 border-[var(--line-ink)]" aria-hidden="true" />
        </div>
      )}

      {items.length > 0 && canLoadMore ? (
        <div className="mt-5 flex justify-center">
          <button
            className="ink-block inline-flex min-h-10 items-center gap-2 rounded-[2px] bg-[var(--paper-raised)] px-4 text-sm font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canUseActions}
            type="button"
            onClick={onLoadMore}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
            加载更多
          </button>
        </div>
      ) : null}
    </section>
  );
}
