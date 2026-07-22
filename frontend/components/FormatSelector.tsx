"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { getDisplayFormats } from "@/lib/format-display";
import type { FormatDiagnostics, VideoFormat } from "@/lib/types";

interface FormatSelectorProps {
  formats: VideoFormat[];
  formatDiagnostics?: FormatDiagnostics | null;
  isFromCache?: boolean;
  sourceUrl?: string | null;
}

type DownloadStatus = "idle" | "downloading" | "success" | "error";

interface FormatDownloadState {
  status: DownloadStatus;
  message?: string;
  filePath?: string;
}

function formatFilesize(filesize: number | null): string {
  if (!filesize) {
    return "未知大小";
  }

  return `${(filesize / 1024 / 1024).toFixed(1)} MB`;
}

function getFormatHeight(format: VideoFormat): number {
  const match = format.resolution.match(/^(\d+)p$/);
  if (!match) {
    return 0;
  }

  return Number.parseInt(match[1], 10);
}

function getFormatHint(
  formats: VideoFormat[],
  isFromCache: boolean,
  formatDiagnostics?: FormatDiagnostics | null
): string {
  const maxHeight = Math.max(0, ...formats.map(getFormatHeight));
  if (formatDiagnostics?.is_bilibili && formats.length === 0) {
    return "B 站元数据已提取；播放格式接口本次被平台拒绝，暂不提供本地保存选项。";
  }

  if (formats.length === 0) {
    return "当前没有可保存的媒体格式数据。";
  }

  if (isFromCache && maxHeight > 0) {
    return `当前展示本地历史缓存，最高 ${maxHeight}p；如需刷新平台最新可用格式，请点上方“重新提取”。`;
  }

  if (
    formatDiagnostics?.is_bilibili &&
    maxHeight > 0 &&
    maxHeight < 720
  ) {
    return formatDiagnostics.has_cookie_config
      ? `B 站登录态本次最高返回 ${maxHeight}p；清晰度以当前账号和视频实际权限为准。`
      : `当前未启用 B 站登录态，平台本次最高返回 ${maxHeight}p；配置本地 Cookie 后请重新提取。`;
  }

  if (maxHeight > 0 && maxHeight < 720) {
    return `当前平台公开格式最高 ${maxHeight}p；更高清晰度不在本次公开结果中。`;
  }

  if (maxHeight >= 720) {
    return `当前平台公开格式最高 ${maxHeight}p；标记为“仅视频”的格式保存时会合并最佳音频。`;
  }

  return "这里用于把当前媒体保存到本地，不影响总结、摘录和知识稿生成。";
}

function isVideoOnly(format: VideoFormat): boolean {
  return format.vcodec !== "none" && format.acodec === "none";
}

function getDownloadButtonClassName(status: DownloadStatus): string {
  const baseClassName =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-[background-color,border-color,color,scale] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60";

  if (status === "success") {
    return `${baseClassName} border-emerald-200 bg-emerald-50 text-emerald-700`;
  }

  if (status === "error") {
    return `${baseClassName} border-rose-200 bg-rose-50 text-rose-700`;
  }

  return `${baseClassName} border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--muted-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]`;
}

function getDownloadIcon(status: DownloadStatus) {
  if (status === "downloading") {
    return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
  }

  if (status === "success") {
    return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  }

  if (status === "error") {
    return <AlertCircle className="h-4 w-4" aria-hidden="true" />;
  }

  return <Download className="h-4 w-4" aria-hidden="true" />;
}

function getDownloadTitle(
  sourceUrl: string | null | undefined,
  format: VideoFormat,
  state: FormatDownloadState
): string {
  if (!sourceUrl) {
    return "当前结果不支持真实下载";
  }

  if (state.status === "downloading") {
    return "正在下载到本地目录";
  }

  if (state.status === "success") {
    return state.filePath ?? "下载完成";
  }

  if (state.status === "error") {
    return state.message ?? "下载失败";
  }

  return isVideoOnly(format) ? "下载并合并音频" : "下载到本地目录";
}

export function FormatSelector({
  formatDiagnostics = null,
  formats,
  isFromCache = false,
  sourceUrl
}: FormatSelectorProps) {
  const displayFormats = getDisplayFormats(formats);
  const [downloadStates, setDownloadStates] = useState<
    Record<string, FormatDownloadState>
  >({});
  const isAnyDownloading = Object.values(downloadStates).some(
    (state) => state.status === "downloading"
  );

  const handleDownload = async (
    formatId: string,
    mergeWithAudio: boolean,
    stateKey = formatId
  ) => {
    if (!sourceUrl || isAnyDownloading) {
      return;
    }

    setDownloadStates((currentStates) => ({
      ...currentStates,
      [stateKey]: {
        status: "downloading",
        message:
          formatId === "best"
            ? "正在自动选择最佳可用格式..."
            : mergeWithAudio
              ? "正在下载并合并音频..."
              : "正在下载..."
      }
    }));

    try {
      const response = await apiClient.downloadVideo(
        sourceUrl,
        formatId,
        mergeWithAudio
      );
      setDownloadStates((currentStates) => ({
        ...currentStates,
        [stateKey]: {
          filePath: response.file_path,
          message: `已保存：${response.filename}`,
          status: "success"
        }
      }));
    } catch (error) {
      setDownloadStates((currentStates) => ({
        ...currentStates,
        [stateKey]: {
          message:
            error instanceof Error ? error.message : "下载失败，请稍后重试。",
          status: "error"
        }
      }));
    }
  };

  return (
    <section className="min-w-0 rounded-[24px] bg-[var(--paper-raised)] p-4 shadow-[var(--shadow-paper)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            Local download
          </p>
          <h2 className="font-editorial mt-1 text-lg font-semibold text-[var(--ink)]">本地下载</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            {getFormatHint(displayFormats, isFromCache, formatDiagnostics)}
          </p>
        </div>
        <HardDrive className="h-4 w-4 text-[var(--muted)]" aria-hidden="true" />
      </div>

      <div className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
        {sourceUrl && displayFormats.length > 0 ? (
          <div className="flex items-start justify-between gap-3 rounded-[16px] bg-[var(--paper-deep)]/70 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--ink)]">
                下载最高画质
              </p>
              <p className="mt-1 truncate text-xs text-[var(--muted)]">
                自动选择当前平台返回的最高画质，并在需要时合并最佳音频
              </p>
              {downloadStates.best?.message ? (
                <p
                    className="mt-2 truncate text-xs text-[var(--muted)]"
                  title={downloadStates.best.filePath}
                >
                  {downloadStates.best.message}
                </p>
              ) : null}
            </div>
            <button
              className={getDownloadButtonClassName(
                downloadStates.best?.status ?? "idle"
              )}
              disabled={
                isAnyDownloading || downloadStates.best?.status === "downloading"
              }
              onClick={() => void handleDownload("best", false, "best")}
              title="下载最高画质"
              type="button"
            >
              {getDownloadIcon(downloadStates.best?.status ?? "idle")}
            </button>
          </div>
        ) : null}
        {displayFormats.length > 0 ? (
          displayFormats.map((format) => {
            const downloadState: FormatDownloadState = downloadStates[
              format.format_id
            ] ?? {
              status: "idle"
            };
            const isDisabled =
              !sourceUrl ||
              isAnyDownloading ||
              downloadState.status === "downloading";

            return (
              <div
                className="flex items-start justify-between gap-3 rounded-[16px] bg-[var(--paper-deep)]/70 px-3 py-3"
                key={format.format_id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">
                    {format.label}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {format.ext.toUpperCase()} · {format.resolution} ·{" "}
                    {formatFilesize(format.filesize)}
                  </p>
                  {downloadState.message ? (
                    <p
                      className="mt-2 truncate text-xs text-[var(--muted)]"
                      title={downloadState.filePath}
                    >
                      {downloadState.message}
                    </p>
                  ) : null}
                </div>
                <button
                  className={getDownloadButtonClassName(downloadState.status)}
                  disabled={isDisabled}
                  onClick={() =>
                    void handleDownload(format.format_id, isVideoOnly(format))
                  }
                  title={getDownloadTitle(sourceUrl, format, downloadState)}
                  type="button"
                >
                  {getDownloadIcon(downloadState.status)}
                </button>
              </div>
            );
          })
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--line-strong)] bg-[var(--paper-deep)]/60 px-3 py-6 text-center text-sm text-[var(--muted)]">
            暂无格式数据。
          </div>
        )}
      </div>
    </section>
  );
}
