"use client";

import { FileAudio, Loader2, X } from "lucide-react";
import { TranscribeSettingsPanel } from "./TranscribeSettingsPanel";
import type { TranscribeContextSettings } from "@/lib/types";

interface TranscribeSettingsDialogProps {
  isOpen: boolean;
  isTranscribing: boolean;
  mediaTitle?: string | null;
  settings: TranscribeContextSettings;
  onChange: (settings: TranscribeContextSettings) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function TranscribeSettingsDialog({
  isOpen,
  isTranscribing,
  mediaTitle,
  settings,
  onChange,
  onClose,
  onConfirm
}: TranscribeSettingsDialogProps) {
  if (!isOpen) {
    return null;
  }

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
          <TranscribeSettingsPanel
            disabled={isTranscribing}
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
            disabled={isTranscribing}
            type="button"
            onClick={onConfirm}
          >
            {isTranscribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileAudio className="h-4 w-4" />
            )}
            {isTranscribing ? "生成中" : "开始生成"}
          </button>
        </div>
      </section>
    </div>
  );
}
