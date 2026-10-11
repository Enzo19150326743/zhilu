"use client";

import { FileAudio, Loader2 } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { TranscribeSettingsPanel } from "./TranscribeSettingsPanel";
import type { TranscribeContextSettings } from "@/lib/types";

interface TranscribeSettingsDialogProps {
  isOpen: boolean;
  isTranscribing: boolean;
  settings: TranscribeContextSettings;
  asrAvailable: boolean;
  correctionAvailable: boolean;
  onChange: (settings: TranscribeContextSettings) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function TranscribeSettingsDialog({
  isOpen,
  isTranscribing,
  settings,
  asrAvailable,
  correctionAvailable,
  onChange,
  onClose,
  onConfirm
}: TranscribeSettingsDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <ModalDialog
      footer={
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
          disabled={isTranscribing || !asrAvailable}
          type="button"
          onClick={onConfirm}
        >
          {isTranscribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileAudio className="h-4 w-4" />
          )}
          {isTranscribing ? "转写中" : "开始转写"}
        </button>
      }
      headerMode="close-only"
      isBusy={isTranscribing}
      isOpen={isOpen}
      size="form"
      title="转写设置"
      onClose={onClose}
    >
      {!asrAvailable ? (
        <p className="mb-4 text-sm text-[var(--accent-deep)]">
          本地语音识别当前不可用，请先准备转写环境并重启后端。
        </p>
      ) : null}

      <TranscribeSettingsPanel
        correctionAvailable={correctionAvailable}
        disabled={isTranscribing || !asrAvailable}
        isAlwaysOpen
        settings={settings}
        onChange={onChange}
      />
    </ModalDialog>
  );
}
