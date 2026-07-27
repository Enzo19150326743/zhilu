"use client";

import { Cloud, Cpu, FileAudio, HardDrive, Loader2, X } from "lucide-react";
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
  sensevoiceAvailable: boolean;
  sensevoiceModel?: string | null;
  sensevoiceMessage?: string | null;
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
  sensevoiceAvailable,
  sensevoiceModel,
  sensevoiceMessage,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-xl border border-zinc-200 bg-white shadow-[0_24px_80px_rgba(24,24,27,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-zinc-950">转写设置</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
              {mediaTitle || "当前媒体"}
            </p>
          </div>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isTranscribing}
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-5 space-y-2">
            <p className="text-xs font-medium text-zinc-500">识别方式</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  asrEngine === "local_whisper"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                }`}
                disabled={isTranscribing}
                type="button"
                onClick={() => onChangeAsrEngine("local_whisper")}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <HardDrive className="h-4 w-4" aria-hidden="true" />
                  本地识别
                </span>
                <span
                  className={`mt-1.5 block text-xs leading-5 ${
                    asrEngine === "local_whisper" ? "text-zinc-300" : "text-zinc-500"
                  }`}
                >
                  默认、免费，音频不会上传到云端。
                </span>
              </button>

              <button
                className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  asrEngine === "sensevoice_small"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300"
                }`}
                disabled={isTranscribing || !sensevoiceAvailable}
                type="button"
                onClick={() => onChangeAsrEngine("sensevoice_small")}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Cpu className="h-4 w-4" aria-hidden="true" />
                  SenseVoice
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-zinc-500">
                  {sensevoiceAvailable
                    ? "本地免费识别，适合与 Whisper 重转写对比。"
                    : sensevoiceMessage || "本地 SenseVoice 依赖尚未安装。"}
                </span>
                {sensevoiceAvailable && sensevoiceModel ? (
                  <span className="mt-1 block break-all text-[11px] text-emerald-700">
                    {sensevoiceModel}
                  </span>
                ) : null}
              </button>

              <button
                className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  asrEngine === "fun_asr_flash"
                    ? "border-blue-600 bg-blue-50 text-blue-900"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-blue-300"
                }`}
                disabled={isTranscribing || !cloudAvailable}
                type="button"
                onClick={() => onChangeAsrEngine("fun_asr_flash")}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                  云端快速识别
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-zinc-500">
                  {cloudAvailable
                    ? "音频片段会发送给阿里云，按量计费，约 0.79 元/小时。"
                    : "后端尚未配置 DASHSCOPE_API_KEY，当前不可选。"}
                </span>
                {cloudAvailable && cloudModel ? (
                  <span className="mt-1 block text-[11px] text-blue-700">
                    {cloudModel}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          <TranscribeSettingsPanel
            disabled={
              isTranscribing || selectedEngineUnavailable
            }
            isAlwaysOpen
            settings={settings}
            onChange={onChange}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isTranscribing}
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
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
        </div>
      </section>
    </div>
  );
}
