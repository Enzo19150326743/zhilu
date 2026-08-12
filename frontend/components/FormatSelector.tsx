"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
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
    return "";
  }

  if (
    formatDiagnostics?.is_bilibili &&
    maxHeight > 0 &&
    maxHeight < 720
  ) {
    return formatDiagnostics.has_cookie_config
      ? `B 站登录态本次最高返回 ${maxHeight}p；清晰度以当前账号和视频实际权限为准。`
      : `当前未启用 B 站登录态，平台本次最高返回 ${maxHeight}p。`;
  }

  if (maxHeight > 0 && maxHeight < 720) {
    return `当前平台公开格式最高 ${maxHeight}p；更高清晰度不在本次公开结果中。`;
  }

  if (maxHeight >= 720) {
    return `当前平台公开格式最高 ${maxHeight}p；标记为“仅视频”的格式下载时会合并最佳音频。`;
  }

  return "文件将通过浏览器下载，请确保你拥有相应内容的访问和处理权限。";
}

function isVideoOnly(format: VideoFormat): boolean {
  return format.vcodec !== "none" && format.acodec === "none";
}

function getDownloadButtonClassName(status: DownloadStatus): string {
  const baseClassName =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] transition-[box-shadow,transform,background-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-60";

  if (status === "success") {
    return `${baseClassName} bg-[#e9f2ea] text-[#2f5d3a]`;
  }

  if (status === "error") {
    return `${baseClassName} bg-[var(--accent-soft)] text-[var(--accent)]`;
  }

  return `${baseClassName} bg-[var(--paper-raised)] text-[var(--ink)] shadow-[2px_2px_0_0_var(--ink)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_var(--ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`;
}

function getDownloadIcon(status: DownloadStatus) {
  if (status === "downloading") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
  }

  if (status === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  if (status === "error") {
    return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  return <Download className="h-3.5 w-3.5" aria-hidden="true" />;
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
    return "正在下载...";
  }

  if (state.status === "success") {
    return "下载成功";
  }

  if (state.status === "error") {
    return state.message ?? "下载失败";
  }

  return isVideoOnly(format) ? "下载并合并音频" : "通过浏览器下载";
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(downloadUrl);
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
  const [showAdvancedFormats, setShowAdvancedFormats] = useState(false);
  const isAnyDownloading = Object.values(downloadStates).some(
    (state) => state.status === "downloading"
  );
  const audioFormat = displayFormats.find((format) => format.vcodec === "none");
  const compactFormats = audioFormat ? [audioFormat] : [];
  const advancedFormats = displayFormats.filter(
    (format) => format.format_id !== audioFormat?.format_id
  );
  const visibleFormats = showAdvancedFormats
    ? [...compactFormats, ...advancedFormats]
    : compactFormats;

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
        message: "正在下载..."
      }
    }));

    try {
      const response = await apiClient.downloadVideo(
        sourceUrl,
        formatId,
        mergeWithAudio
      );
      triggerBrowserDownload(response.blob, response.filename);
      setDownloadStates((currentStates) => ({
        ...currentStates,
        [stateKey]: {
          message: "下载成功",
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
    <section className="min-w-0 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-4">
      <p className="text-[13px] font-semibold text-[var(--ink-soft)]">辅助下载</p>
      <p className="mt-2 text-[11px] leading-[17px] text-[var(--muted)]">
        {getFormatHint(displayFormats, isFromCache, formatDiagnostics)}
      </p>

      <div className="mt-3 max-h-[24rem] space-y-2 overflow-y-auto overscroll-contain">
        {sourceUrl && displayFormats.length > 0 ? (
          <div className="flex items-start justify-between gap-3 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-[var(--ink)]">
                最佳可用格式
              </p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                自动选择最高画质，需要时合并最佳音频
              </p>
              {downloadStates.best?.message ? (
                <p
                  className="mt-1.5 truncate text-[11px] text-[var(--muted)]"
                  title={downloadStates.best.message}
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
          visibleFormats.map((format) => {
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
                className="flex items-start justify-between gap-3 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2.5"
                key={format.format_id}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--ink)]">
                    {format.label}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                    {format.ext.toUpperCase()} · {format.resolution} ·{" "}
                    {formatFilesize(format.filesize)}
                  </p>
                  {downloadState.message ? (
                    <p
                      className="mt-1.5 truncate text-[11px] text-[var(--muted)]"
                      title={downloadState.message}
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
          <div className="rounded-[2px] border border-dashed border-[var(--line-strong)] px-3 py-5 text-center text-[13px] text-[var(--muted)]">
            暂无格式数据。
          </div>
        )}
      </div>
      {advancedFormats.length > 0 ? (
        <button
          className="mt-3 flex min-h-9 w-full items-center justify-between border-t border-[var(--line-strong)] pt-3 text-xs font-medium text-[var(--muted-strong)] transition-colors hover:text-[var(--accent)]"
          type="button"
          onClick={() => setShowAdvancedFormats((current) => !current)}
        >
          <span>
            {showAdvancedFormats
              ? "收起可选格式"
              : `查看其他 ${advancedFormats.length} 个格式`}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${showAdvancedFormats ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}
    </section>
  );
}
