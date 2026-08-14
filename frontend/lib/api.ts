import type {
  ApiError,
  AsrStatusResponse,
  BrowserDownloadResponse,
  CorrectionTermLibraryResponse,
  DemoListResponse,
  HealthResponse,
  LibraryClearResponse,
  LibraryDeleteResponse,
  LibraryFilter,
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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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

function getDownloadFilename(contentDisposition: string | null): string {
  if (!contentDisposition) {
    return "media-download";
  }

  const encodedFilename = contentDisposition.match(
    /filename\*=utf-8''([^;]+)/i
  )?.[1];
  if (encodedFilename) {
    try {
      return decodeURIComponent(encodedFilename);
    } catch {
      return encodedFilename;
    }
  }

  return (
    contentDisposition.match(/filename="([^"]+)"/i)?.[1] ??
    contentDisposition.match(/filename=([^;]+)/i)?.[1]?.trim() ??
    "media-download"
  );
}

async function requestBrowserDownload(
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<BrowserDownloadResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/octet-stream",
        "Content-Type": "application/json"
      },
      method: "POST",
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

    return {
      blob: await response.blob(),
      filename: getDownloadFilename(response.headers.get("Content-Disposition"))
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("下载超时，请稍后重试。", 0, "TIMEOUT");
    }

    if (error instanceof TypeError) {
      const isBackendReachable = await checkBackendReachable();
      if (isBackendReachable) {
        throw new ApiClientError(
          "后端服务当前可访问，但下载连接已中断，请稍后重试。",
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
  getAsrStatus(): Promise<AsrStatusResponse> {
    return requestJson<AsrStatusResponse>("/api/asr/status", {
      timeoutMs: 2500
    });
  },
  getCorrectionTermLibrary(): Promise<CorrectionTermLibraryResponse> {
    return requestJson<CorrectionTermLibraryResponse>("/api/correction-terms", {
      timeoutMs: 5000
    });
  },
  getDemos(): Promise<DemoListResponse> {
    return requestJson<DemoListResponse>("/api/demo", { timeoutMs: 3000 });
  },
  getDemoDetail(demoId: string): Promise<ParseResponse> {
    return requestJson<ParseResponse>(`/api/demo/${demoId}`, { timeoutMs: 5000 });
  },
  getRecentLibraryItems(
    limit = 8,
    filter: LibraryFilter = "all"
  ): Promise<LibraryListResponse> {
    const query = new URLSearchParams({ filter, limit: String(limit) });
    return requestJson<LibraryListResponse>(`/api/library/recent?${query}`, {
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
  parseVideo(url: string): Promise<ParseResponse> {
    return requestJson<ParseResponse>("/api/parse", {
      body: { url },
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
  ): Promise<BrowserDownloadResponse> {
    return requestBrowserDownload(
      "/api/download/file",
      {
        format_id: formatId,
        merge_with_audio: mergeWithAudio,
        url
      },
      600000
    );
  }
};
