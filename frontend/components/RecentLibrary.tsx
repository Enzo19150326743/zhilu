import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  RefreshCw,
  Trash2
} from "lucide-react";
import { IconActionButton } from "./IconActionButton";
import type {
  LibraryFilter,
  LibraryItem,
  LibraryStatsResponse
} from "@/lib/types";
import {
  formatLibraryUpdatedAt,
  getLibraryDisplayTitle,
  getLibraryStatusLabel
} from "@/lib/library-display";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import { isPodcastMedia } from "@/lib/media";
import { getPlatformLabel } from "@/lib/platform-display";

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
  processingVideoIds: ReadonlySet<string>;
  stats: LibraryStatsResponse | null;
  onChangeFilter: (filter: LibraryFilter) => void;
  onClearAll: () => void;
  onCopySourceUrl: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onLoadMore: () => void;
  onOpenItem: (item: LibraryItem) => void;
  onRefresh: () => void;
}

function LibraryThumbnail({ item }: { item: LibraryItem }) {
  const thumbnailUrl = getDisplayThumbnailUrl(item.thumbnail);
  const fallbackLabel = isPodcastMedia(item) ? "播客" : getPlatformLabel(item.platform);

  return (
    <span className="relative block aspect-video w-[68px] shrink-0 overflow-hidden border-2 border-[var(--line-ink)] bg-[var(--paper-deep)]">
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[var(--muted)]"
      >
        {fallbackLabel}
      </span>
      {thumbnailUrl ? (
        <img
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          referrerPolicy="no-referrer"
          src={thumbnailUrl}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
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
  processingVideoIds,
  stats,
  onChangeFilter,
  onClearAll,
  onCopySourceUrl,
  onDeleteItem,
  onLoadMore,
  onOpenItem,
  onRefresh
}: RecentLibraryProps) {
  const visibleItems = items;
  const isCollectionBusy = isLoading || isClearing;
  const canUseCollectionActions = !disabled && !isCollectionBusy;
  const totalItems = stats?.total_items ?? items.length;
  const allFilterOptions: Array<{
    count: number;
    key: LibraryFilter;
    label: string;
  }> = [
    { count: stats?.total_items ?? items.length, key: "all", label: "全部" },
    {
      count: stats?.ready_count ?? 0,
      key: "ready",
      label: "可总结"
    },
    {
      count: stats?.summarized_count ?? 0,
      key: "summarized",
      label: "已总结"
    },
    {
      count: stats?.needs_transcript_count ?? 0,
      key: "noTranscript",
      label: "需转写"
    }
  ];
  const filterOptions = allFilterOptions.filter(
    (option) => option.key === "all" || option.count > 0 || option.key === filter
  );

  return (
    <section className="mx-auto max-w-[90rem] bg-[var(--paper)] px-4 pb-20 pt-8 sm:px-6 lg:px-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="font-editorial text-[28px] font-bold leading-tight text-[var(--ink)]">
          最近档案
        </h2>
        <div className="flex items-center gap-2">
          {totalItems > 0 ? (
            <IconActionButton
              disabled={!canUseCollectionActions || isRefreshing}
              icon={Trash2}
              label="清空全部档案"
              tone="danger"
              onClick={onClearAll}
            />
          ) : null}
          <IconActionButton
            disabled={!canUseCollectionActions}
            icon={RefreshCw}
            isSpinning={isRefreshing}
            label="刷新最近档案"
            onClick={onRefresh}
          />
        </div>
      </div>

      {!isLoading ? (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {filterOptions.map((filterOption) => {
            const isActive = filter === filterOption.key;

            return (
              <button
                className={`inline-flex min-h-9 shrink-0 items-center border-2 border-[var(--line-ink)] px-3 text-xs tabular-nums transition-[background-color,color,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? "bg-[var(--ink)] font-semibold text-[var(--paper-raised)] shadow-[2px_2px_0_0_var(--accent)]"
                    : "bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:bg-[var(--accent-soft)]"
                }`}
                disabled={!canUseCollectionActions || isRefreshing}
                key={filterOption.key}
                type="button"
                onClick={() => onChangeFilter(filterOption.key)}
              >
                {filterOption.label} {filterOption.count}
              </button>
            );
          })}
        </div>
      ) : null}

      {isLoading ? (
        <div aria-label="正在加载最近档案" aria-live="polite" role="status">
          <span className="sr-only">正在加载最近档案</span>
          <div className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-4 border-y-2 border-[var(--line-ink)] py-2.5 sm:grid-cols-[minmax(0,1fr)_104px_92px_86px_84px]">
            {["内容", "来源", "状态", "时间", "操作"].map((label, index) => (
              <span
                className={`text-xs font-semibold text-[var(--muted)] ${index > 0 && index < 4 ? "hidden sm:block" : ""}`}
                key={label}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="divide-y divide-[var(--line-ink)]/60">
            {[0, 1, 2].map((rowIndex) => (
              <div
                className="grid h-[68px] grid-cols-[minmax(0,1fr)_84px] items-center gap-4 sm:grid-cols-[minmax(0,1fr)_104px_92px_86px_84px]"
                key={rowIndex}
              >
                <span className="h-9 w-3/4 animate-pulse bg-[var(--paper-deep)]" />
                <span className="hidden h-3 w-16 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="hidden h-3 w-14 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="hidden h-3 w-16 animate-pulse bg-[var(--paper-deep)] sm:block" />
                <span className="h-8 w-16 animate-pulse bg-[var(--paper-deep)]" />
              </div>
            ))}
          </div>
          <div className="border-t-2 border-[var(--line-ink)]" aria-hidden="true" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          暂无本地档案。解析公开媒体链接后，可以从这里继续阅读。
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          当前筛选下没有记录，请切换筛选条件。
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-4 border-y-2 border-[var(--line-ink)] py-2.5 sm:grid-cols-[minmax(0,1fr)_104px_92px_86px_84px]">
            {["内容", "来源", "状态", "时间", "操作"].map((label, index) => (
              <span
                className={`text-xs font-semibold text-[var(--muted)] ${index > 0 && index < 4 ? "hidden sm:block" : ""}`}
                key={label}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="divide-y divide-[var(--line-ink)]/60">
            {visibleItems.map((item) => {
              const isActive = activeVideoId === item.video_id;
              const isCopied = copiedVideoId === item.video_id;
              const isLoadingItem = loadingVideoId === item.video_id;
              const isDeleting = deletingVideoId === item.video_id;
              const isDisabled = disabled || isClearing || isLoadingItem || isDeleting;

              return (
                <div
                  className={`group grid min-h-[68px] grid-cols-[minmax(0,1fr)_84px] items-center gap-4 transition-colors hover:bg-[var(--paper-raised)] sm:grid-cols-[minmax(0,1fr)_104px_92px_86px_84px] ${
                    isActive
                      ? "bg-[var(--accent-soft)]/70 shadow-[inset_4px_0_0_0_var(--accent)]"
                      : ""
                  }`}
                  key={`${item.video_id}-${item.updated_at}`}
                >
                  <button
                    aria-label={getLibraryDisplayTitle(item.title)}
                    className="grid min-w-0 grid-cols-[68px_minmax(0,1fr)] items-center gap-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isDisabled}
                    type="button"
                    onClick={() => onOpenItem(item)}
                  >
                    <LibraryThumbnail item={item} />
                    <span className="min-w-0">
                      <span className="font-editorial block truncate text-sm font-semibold leading-6 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
                        {getLibraryDisplayTitle(item.title)}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                        {item.author || "未知作者"}
                      </span>
                    </span>
                  </button>
                  <span className="hidden truncate text-xs text-[var(--muted)] sm:block">
                    {isPodcastMedia(item) ? "小宇宙" : getPlatformLabel(item.platform)}
                  </span>
                  <span className="hidden truncate text-xs font-medium text-[var(--ink-soft)] sm:block">
                    {isLoadingItem ? (
                      <Loader2
                        aria-label="正在打开档案"
                        className="h-3.5 w-3.5 animate-spin text-[var(--accent)]"
                      />
                    ) : (
                      getLibraryStatusLabel(
                        item,
                        processingVideoIds.has(item.video_id)
                      )
                    )}
                  </span>
                  <span className="hidden truncate text-[11px] text-[var(--muted)] sm:block">
                    {formatLibraryUpdatedAt(item.updated_at)}
                  </span>
                  <div className="flex w-[84px] items-center justify-end gap-2 opacity-75 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <IconActionButton
                      disabled={disabled || isClearing || isDeleting}
                      icon={isCopied ? Check : Copy}
                      label={isCopied ? "源链接已复制" : "复制源链接"}
                      onClick={() => onCopySourceUrl(item)}
                    />
                    <IconActionButton
                      ariaLabel={`删除《${getLibraryDisplayTitle(item.title)}》`}
                      disabled={disabled || isClearing || isDeleting}
                      icon={isDeleting ? Loader2 : Trash2}
                      isSpinning={isDeleting}
                      label="删除档案"
                      tone="danger"
                      onClick={() => onDeleteItem(item)}
                    />
                  </div>
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
            className="ink-block inline-flex min-h-10 items-center gap-2 bg-[var(--paper-raised)] px-4 text-sm font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canUseCollectionActions || isRefreshing}
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
