"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api";
import { getDisplayFormats } from "@/lib/format-display";
import type { VideoFormat } from "@/lib/types";

interface FormatSelectorProps {
  formats: VideoFormat[];
  sourceUrl?: string | null;
}

export function FormatSelector({ formats, sourceUrl }: FormatSelectorProps) {
  const format = getDisplayFormats(formats)[0];
  const [status, setStatus] = useState<"idle" | "downloading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  if (!format || !sourceUrl) {
    return <p className="text-xs text-[var(--muted)]">暂无可下载格式</p>;
  }

  const mergeWithAudio = format.vcodec !== "none" && format.acodec === "none";
  const downloadLabel = format.vcodec === "none" ? "下载原音频" : "下载原视频";
  const metadata = [
    /^\d+p$/i.test(format.resolution) ? format.resolution.toUpperCase() : null,
    format.ext.toLowerCase(),
    !mergeWithAudio && format.filesize && format.filesize > 0
      ? `${(format.filesize / 1024 / 1024).toFixed(1)} MB`
      : null
  ].filter(Boolean).join(" · ");

  const handleDownload = async () => {
    if (status === "downloading") return;
    setStatus("downloading");
    setErrorMessage("");
    try {
      const response = await apiClient.downloadVideo(sourceUrl, format.format_id, mergeWithAudio);
      const downloadUrl = URL.createObjectURL(response.blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = response.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "下载失败，请重试。");
      setStatus("error");
    }
  };

  const buttonLabel = status === "downloading"
    ? "正在下载"
    : status === "error" ? "重试下载" : downloadLabel;
  const Icon = status === "downloading" ? Loader2
    : status === "success" ? CheckCircle2
    : status === "error" ? AlertCircle : Download;

  return (
    <div className="w-full min-w-0 max-w-sm rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ink)]">{downloadLabel}</p>
          <p className="mt-1 text-xs text-[var(--muted)] [overflow-wrap:anywhere]">{metadata}</p>
        </div>
        <button
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink)] transition-colors hover:border-[var(--ink)] hover:bg-[var(--paper-deep)] disabled:cursor-wait disabled:opacity-60"
          type="button"
          aria-label={buttonLabel}
          title={buttonLabel}
          disabled={status === "downloading"}
          onClick={() => void handleDownload()}
        >
          <Icon className={`h-4 w-4 ${status === "downloading" ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
        <p className="mt-2 text-xs text-[var(--muted)] empty:hidden" role="status">
          {status === "downloading" ? "正在下载…" : status === "success" ? "已发起保存" : ""}
        </p>
      {errorMessage ? <p className="mt-2 text-xs text-[var(--accent)] [overflow-wrap:anywhere]" role="alert">{errorMessage}</p> : null}
    </div>
  );
}
