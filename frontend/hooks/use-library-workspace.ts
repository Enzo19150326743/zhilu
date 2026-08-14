"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api";
import type {
  LibraryFilter,
  LibraryItem,
  LibraryStatsResponse
} from "@/lib/types";

const INITIAL_LIBRARY_LIMIT = 8;
const LIBRARY_LIMIT_STEP = 8;
const MAX_LIBRARY_LIMIT = 50;

function getFilteredTotal(
  stats: LibraryStatsResponse | null,
  filter: LibraryFilter,
  fallbackCount: number
): number {
  if (!stats) {
    return fallbackCount;
  }
  if (filter === "ready") {
    return stats.ready_count;
  }
  if (filter === "summarized") {
    return stats.summarized_count;
  }
  if (filter === "noTranscript") {
    return stats.needs_transcript_count;
  }
  return stats.total_items;
}

export type PendingLibraryAction =
  | { kind: "clear" }
  | { item: LibraryItem; kind: "delete" };

export type ConfirmedLibraryAction =
  | { kind: "clear" }
  | { kind: "delete"; videoId: string };

interface UseLibraryWorkspaceOptions {
  onError: (message: string | null) => void;
}

export function useLibraryWorkspace({
  onError
}: UseLibraryWorkspaceOptions) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [stats, setStats] = useState<LibraryStatsResponse | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const filterRef = useRef<LibraryFilter>("all");
  const [limit, setLimit] = useState(INITIAL_LIBRARY_LIMIT);
  const limitRef = useRef(INITIAL_LIBRARY_LIMIT);
  const refreshRequestIdRef = useRef(0);
  const [copiedVideoId, setCopiedVideoId] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PendingLibraryAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(
    async (showRefreshState = false, requestedLimit = limitRef.current) => {
      const requestId = refreshRequestIdRef.current + 1;
      refreshRequestIdRef.current = requestId;
      if (showRefreshState) {
        setIsRefreshing(true);
        onError(null);
      }

      try {
        const [listResponse, statsResponse] = await Promise.all([
          apiClient.getRecentLibraryItems(requestedLimit, filterRef.current),
          apiClient.getLibraryStats()
        ]);
        if (requestId === refreshRequestIdRef.current) {
          setItems(listResponse.items);
          setStats(statsResponse);
        }
      } catch {
        if (showRefreshState) {
          onError("最近解析刷新失败，请确认后端服务已启动。");
        }
      } finally {
        if (requestId === refreshRequestIdRef.current) {
          setIsLoading(false);
        }
        if (showRefreshState && requestId === refreshRequestIdRef.current) {
          setIsRefreshing(false);
        }
      }
    },
    [onError]
  );

  useEffect(() => {
    void refresh(false, INITIAL_LIBRARY_LIMIT);
  }, [refresh]);

  const refreshManually = () => {
    void refresh(true);
  };

  const loadMore = () => {
    const nextLimit = Math.min(limit + LIBRARY_LIMIT_STEP, MAX_LIBRARY_LIMIT);
    setLimit(nextLimit);
    limitRef.current = nextLimit;
    void refresh(true, nextLimit);
  };

  const changeFilter = (nextFilter: LibraryFilter) => {
    if (nextFilter === filterRef.current) {
      return;
    }

    filterRef.current = nextFilter;
    setFilter(nextFilter);
    setLimit(INITIAL_LIBRARY_LIMIT);
    limitRef.current = INITIAL_LIBRARY_LIMIT;
    void refresh(true, INITIAL_LIBRARY_LIMIT);
  };

  const copySourceUrl = async (item: LibraryItem) => {
    try {
      await navigator.clipboard.writeText(item.source_url);
      setCopiedVideoId(item.video_id);
      window.setTimeout(() => {
        setCopiedVideoId((currentVideoId) =>
          currentVideoId === item.video_id ? null : currentVideoId
        );
      }, 1600);
    } catch {
      onError("源链接复制失败，请手动打开历史记录后复制。");
    }
  };

  const requestDelete = (item: LibraryItem) => {
    setActionError(null);
    setPendingAction({ item, kind: "delete" });
  };

  const requestClear = () => {
    setActionError(null);
    setPendingAction({ kind: "clear" });
  };

  const cancelPendingAction = () => {
    setPendingAction(null);
    setActionError(null);
  };

  const confirmPendingAction = async (): Promise<ConfirmedLibraryAction | null> => {
    if (!pendingAction) {
      return null;
    }

    setActionError(null);

    if (pendingAction.kind === "delete") {
      const item = pendingAction.item;
      setDeletingVideoId(item.video_id);

      try {
        await apiClient.deleteLibraryItem(item.video_id);
        setItems((currentItems) =>
          currentItems.filter(
            (currentItem) => currentItem.video_id !== item.video_id
          )
        );
        setCopiedVideoId((currentVideoId) =>
          currentVideoId === item.video_id ? null : currentVideoId
        );
        setPendingAction(null);
        void refresh(false, limit);
        return { kind: "delete", videoId: item.video_id };
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "历史记录删除失败，请稍后重试。"
        );
        return null;
      } finally {
        setDeletingVideoId(null);
      }
    }

    setIsClearing(true);

    try {
      await apiClient.clearLibraryItems();
      setItems([]);
      setStats({
        ai_summary_count: 0,
        fallback_summary_count: 0,
        needs_transcript_count: 0,
        ready_count: 0,
        no_transcript_count: 0,
        success: true,
        summarized_count: 0,
        total_items: 0,
        with_transcript_count: 0
      });
      setFilter("all");
      filterRef.current = "all";
      setCopiedVideoId(null);
      setPendingAction(null);
      return { kind: "clear" };
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "本地历史清空失败，请稍后重试。"
      );
      return null;
    } finally {
      setIsClearing(false);
    }
  };

  const resetInteractionState = () => {
    setDeletingVideoId(null);
    setIsRefreshing(false);
    setIsClearing(false);
    setPendingAction(null);
    setActionError(null);
    setCopiedVideoId(null);
  };

  const filteredTotal = getFilteredTotal(stats, filter, items.length);

  return {
    actionError,
    canLoadMore: filteredTotal > items.length && limit < MAX_LIBRARY_LIMIT,
    cancelPendingAction,
    confirmPendingAction,
    copiedVideoId,
    copySourceUrl,
    deletingVideoId,
    filter,
    isClearing,
    isLoading,
    isRefreshing,
    items,
    loadMore,
    pendingAction,
    refresh,
    refreshManually,
    requestClear,
    requestDelete,
    resetInteractionState,
    setFilter: changeFilter,
    stats
  };
}
