import type {
  ApiError,
  DemoDetail,
  DemoListResponse,
  DownloadResponse,
  HealthResponse,
  LibraryClearResponse,
  LibraryDeleteResponse,
  LibraryListResponse,
  LibraryStatsResponse,
  NoteDraftUpdateRequest,
  NoteDraftUpdateResponse,
  ObsidianNoteExportRequest,
  ObsidianNoteExportResponse,
  ParseResponse,
  QaRequest,
  QaResponse,
  RateLimitStatusResponse,
  SummarizeRequest,
  SummarizeResponse,
  TranscribeRequest,
  TranscribeResponse
} from "./types";

const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "http://127.0.0.1:8000";

interface RequestJsonOptions {
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  timeoutMs?: number;
}

type ErrorPayload =
  | (Partial<ApiError> & {
      detail?: Partial<ApiError> | string;
    })
  | null;

export class ApiClientError extends Error {
  errorCode?: string;
  status: number;

  constructor(message: string, status: number, errorCode?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

function getErrorMessage(
  errorPayload: ErrorPayload,
  fallbackMessage: string
): string {
  if (!errorPayload) {
    return fallbackMessage;
  }

  if (
    typeof errorPayload.detail === "object" &&
    errorPayload.detail?.message
  ) {
    return errorPayload.detail.message;
  }

  if (typeof errorPayload.detail === "string") {
    return errorPayload.detail;
  }

  return errorPayload.message ?? fallbackMessage;
}

function getErrorCode(errorPayload: ErrorPayload): string | undefined {
  if (!errorPayload) {
    return undefined;
  }

  if (
    typeof errorPayload.detail === "object" &&
    errorPayload.detail?.error_code
  ) {
    return errorPayload.detail.error_code;
  }

  return errorPayload.error_code;
}

async function checkBackendReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/health`, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      },
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestJson<T>(
  path: string,
  options: RequestJsonOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15000
  );
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  try {
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      headers,
      method: options.method ?? "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      const fallbackMessage = `请求失败：${response.status}`;
      const errorPayload = (await response
        .json()
        .catch(() => null)) as ErrorPayload;
      throw new ApiClientError(
        getErrorMessage(errorPayload, fallbackMessage),
        response.status,
        getErrorCode(errorPayload)
      );
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("请求超时，请稍后重试。", 0, "TIMEOUT");
    }

    if (error instanceof TypeError) {
      const isBackendReachable = await checkBackendReachable();
      if (isBackendReachable) {
        throw new ApiClientError(
          "后端服务当前可访问，但这次请求连接中断。请稍后重试；如果刚更新过代码，请刷新页面后再操作。",
          0,
          "REQUEST_INTERRUPTED"
        );
      }

      throw new ApiClientError(
        "无法连接后端服务，请确认后端已启动，并在更新代码后重启后端。",
        0,
        "NETWORK_ERROR"
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const apiClient = {
  getHealth(): Promise<HealthResponse> {
    return requestJson<HealthResponse>("/api/health", { timeoutMs: 2500 });
  },
  getRateLimitStatus(): Promise<RateLimitStatusResponse> {
    return requestJson<RateLimitStatusResponse>("/api/rate-limit/status", {
      timeoutMs: 2500
    });
  },
  getDemos(): Promise<DemoListResponse> {
    return requestJson<DemoListResponse>("/api/demo", { timeoutMs: 3000 });
  },
  getDemoDetail(demoId: string): Promise<DemoDetail> {
    return requestJson<DemoDetail>(`/api/demo/${demoId}`, { timeoutMs: 3000 });
  },
  getRecentLibraryItems(limit = 8): Promise<LibraryListResponse> {
    return requestJson<LibraryListResponse>(`/api/library/recent?limit=${limit}`, {
      timeoutMs: 3000
    });
  },
  getLibraryStats(): Promise<LibraryStatsResponse> {
    return requestJson<LibraryStatsResponse>("/api/library/stats", {
      timeoutMs: 3000
    });
  },
  getLibraryDetail(videoId: string): Promise<ParseResponse> {
    return requestJson<ParseResponse>(`/api/library/${videoId}`, {
      timeoutMs: 5000
    });
  },
  deleteLibraryItem(videoId: string): Promise<LibraryDeleteResponse> {
    return requestJson<LibraryDeleteResponse>(`/api/library/${videoId}`, {
      method: "DELETE",
      timeoutMs: 5000
    });
  },
  clearLibraryItems(): Promise<LibraryClearResponse> {
    return requestJson<LibraryClearResponse>("/api/library", {
      method: "DELETE",
      timeoutMs: 5000
    });
  },
  updateNoteDraft(
    payload: NoteDraftUpdateRequest
  ): Promise<NoteDraftUpdateResponse> {
    return requestJson<NoteDraftUpdateResponse>("/api/library/note-draft", {
      body: payload,
      method: "PUT",
      timeoutMs: 5000
    });
  },
  exportObsidianNote(
    payload: ObsidianNoteExportRequest
  ): Promise<ObsidianNoteExportResponse> {
    return requestJson<ObsidianNoteExportResponse>(
      "/api/exports/obsidian-note",
      {
        body: payload,
        method: "POST",
        timeoutMs: 30000
      }
    );
  },
  parseVideo(url: string, forceRefresh = false): Promise<ParseResponse> {
    return requestJson<ParseResponse>("/api/parse", {
      body: { force_refresh: forceRefresh, url },
      method: "POST",
      timeoutMs: 45000
    });
  },
  summarizeVideo(payload: SummarizeRequest): Promise<SummarizeResponse> {
    return requestJson<SummarizeResponse>("/api/summarize", {
      body: payload,
      method: "POST",
      timeoutMs: 240000
    });
  },
  askQuestion(payload: QaRequest): Promise<QaResponse> {
    return requestJson<QaResponse>("/api/qa", {
      body: payload,
      method: "POST",
      timeoutMs: 180000
    });
  },
  transcribeVideo(payload: TranscribeRequest): Promise<TranscribeResponse> {
    return requestJson<TranscribeResponse>("/api/transcribe", {
      body: payload,
      method: "POST",
      timeoutMs: 1800000
    });
  },
  downloadVideo(
    url: string,
    formatId: string,
    mergeWithAudio: boolean
  ): Promise<DownloadResponse> {
    return requestJson<DownloadResponse>("/api/download", {
      body: {
        format_id: formatId,
        merge_with_audio: mergeWithAudio,
        url
      },
      method: "POST",
      timeoutMs: 600000
    });
  }
};
