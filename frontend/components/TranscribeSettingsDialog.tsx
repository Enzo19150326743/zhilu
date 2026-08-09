"use client";

import { Cloud, Cpu, FileAudio, HardDrive, Loader2 } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { TranscribeSettingsPanel } from "./TranscribeSettingsPanel";
import type { AsrEngine, TranscribeContextSettings } from "@/lib/types";

interface TranscribeSettingsDialogProps {
  isOpen: boolean;
  isTranscribing: boolean;
  mediaTitle?: string | null;
  settings: TranscribeContextSettings;
  asrEngine: AsrEngine;
  cloudAvailable: boolean;
  cloudModel?: string | null;
  whisperModel?: string | null;
  sensevoiceAvailable: boolean;
  sensevoiceModel?: string | null;
  sensevoiceMessage?: string | null;
  correctionAvailable: boolean;
  correctionMessage?: string | null;
  onChange: (settings: TranscribeContextSettings) => void;
  onChangeAsrEngine: (asrEngine: AsrEngine) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function TranscribeSettingsDialog({
  isOpen,
  isTranscribing,
  mediaTitle,
  settings,
  asrEngine,
  cloudAvailable,
  cloudModel,
  whisperModel,
  sensevoiceAvailable,
  sensevoiceModel,
  sensevoiceMessage,
  correctionAvailable,
  correctionMessage,
  onChange,
  onChangeAsrEngine,
  onClose,
  onConfirm
}: TranscribeSettingsDialogProps) {
  if (!isOpen) {
    return null;
  }

  const selectedEngineUnavailable =
    (asrEngine === "fun_asr_flash" && !cloudAvailable) ||
    (asrEngine === "sensevoice_small" && !sensevoiceAvailable);

  return (
    <ModalDialog
      description={mediaTitle || "当前媒体"}
      footer={
        <>
          <button
            className="inline-flex h-10 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] px-4 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isTranscribing}
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-4 text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
            disabled={isTranscribing || selectedEngineUnavailable}
            type="button"
            onClick={onConfirm}
          >
            {isTranscribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileAudio className="h-4 w-4" />
            )}
            {isTranscribing
              ? "生成中"
              : asrEngine === "fun_asr_flash"
                ? "开始云端识别"
                : asrEngine === "sensevoice_small"
                  ? "开始 SenseVoice 识别"
                  : "开始 Whisper 识别"}
          </button>
        </>
      }
      isBusy={isTranscribing}
      isOpen={isOpen}
      size="wide"
      title="转写设置"
      onClose={onClose}
    >
      <div className="mb-5 space-y-2">
        <p className="text-xs font-medium text-[var(--muted)]">识别方式</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            className={`rounded-[2px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              asrEngine === "sensevoice_small"
                ? "border-[#2f5d3a] bg-[#e9f2ea] text-[#2f5d3a]"
                : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:border-[#2f5d3a]"
            }`}
            disabled={isTranscribing || !sensevoiceAvailable}
            type="button"
            onClick={() => onChangeAsrEngine("sensevoice_small")}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4" aria-hidden="true" />
              SenseVoice
              {sensevoiceAvailable ? (
                <span className="rounded-[2px] bg-[#2f5d3a] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--paper)]">
                  推荐
                </span>
              ) : null}
            </span>
            <span className="mt-1.5 block text-xs leading-5 text-[var(--muted)]">
              {sensevoiceAvailable
                ? "中文长视频优先：速度更快、内容更完整，本地免费。"
                : sensevoiceMessage || "本地 SenseVoice 依赖尚未安装。"}
            </span>
            {sensevoiceAvailable && sensevoiceModel ? (
              <span className="mt-1 block break-all text-[11px] text-[#2f5d3a]">
                {sensevoiceModel}
              </span>
            ) : null}
          </button>

          <button
            className={`rounded-[2px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              asrEngine === "local_whisper"
                ? "border-[var(--line-ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:border-[var(--line-strong)]"
            }`}
            disabled={isTranscribing}
            type="button"
            onClick={() => onChangeAsrEngine("local_whisper")}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <HardDrive className="h-4 w-4" aria-hidden="true" />
              Whisper
            </span>
            <span className="mt-1.5 block text-xs leading-5 text-[var(--muted)]">
              英文术语、数字和技术内容更稳，本地免费但速度较慢。
            </span>
            {whisperModel ? (
              <span className="mt-1 block break-all text-[11px] text-[var(--muted)]">
                {whisperModel}
              </span>
            ) : null}
          </button>

          <button
            className={`rounded-[2px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              asrEngine === "fun_asr_flash"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:border-[var(--accent)]"
            }`}
            disabled={isTranscribing || !cloudAvailable}
            type="button"
            onClick={() => onChangeAsrEngine("fun_asr_flash")}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Cloud className="h-4 w-4" aria-hidden="true" />
              云端快速识别
            </span>
            <span className="mt-1.5 block text-xs leading-5 text-[var(--muted)]">
              {cloudAvailable
                ? "音频片段会发送给阿里云，按量计费，约 0.79 元/小时。"
                : "后端尚未配置 DASHSCOPE_API_KEY，当前不可选。"}
            </span>
            {cloudAvailable && cloudModel ? (
              <span className="mt-1 block text-[11px] text-[var(--accent)]">
                {cloudModel}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      <TranscribeSettingsPanel
        correctionAvailable={correctionAvailable}
        correctionMessage={correctionMessage}
        disabled={isTranscribing || selectedEngineUnavailable}
        isAlwaysOpen
        settings={settings}
        onChange={onChange}
      />
    </ModalDialog>
  );
}
