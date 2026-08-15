"use client";

import { Cpu, FileAudio, HardDrive, Loader2 } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { TranscribeSettingsPanel } from "./TranscribeSettingsPanel";
import type { AsrEngine, TranscribeContextSettings } from "@/lib/types";

interface TranscribeSettingsDialogProps {
  isOpen: boolean;
  isTranscribing: boolean;
  settings: TranscribeContextSettings;
  asrEngine: AsrEngine;
  sensevoiceAvailable: boolean;
  correctionAvailable: boolean;
  onChange: (settings: TranscribeContextSettings) => void;
  onChangeAsrEngine: (asrEngine: AsrEngine) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const ENGINE_OPTION_BASE_CLASS_NAME =
  "rounded-[2px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const ENGINE_OPTION_SELECTED_CLASS_NAME =
  "border-[var(--line-ink)] bg-[var(--ink)] text-[var(--paper)]";
const ENGINE_OPTION_IDLE_CLASS_NAME =
  "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:border-[var(--line-ink)]";

function getEngineDescriptionClassName(isSelected: boolean): string {
  return `mt-1.5 block text-xs leading-5 ${
    isSelected ? "text-[var(--paper-deep)]" : "text-[var(--muted)]"
  }`;
}

export function TranscribeSettingsDialog({
  isOpen,
  isTranscribing,
  settings,
  asrEngine,
  sensevoiceAvailable,
  correctionAvailable,
  onChange,
  onChangeAsrEngine,
  onClose,
  onConfirm
}: TranscribeSettingsDialogProps) {
  if (!isOpen) {
    return null;
  }

  const selectedEngineUnavailable =
    asrEngine === "sensevoice_small" && !sensevoiceAvailable;

  return (
    <ModalDialog
      footer={
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[2px] bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--ink)]"
          disabled={isTranscribing || selectedEngineUnavailable}
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
      size="wide"
      title="转写设置"
      onClose={onClose}
    >
      <div className="mb-5 space-y-2">
        <p className="text-xs font-medium text-[var(--muted)]">识别方式</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            aria-label="SenseVoice（推荐）"
            className={`${ENGINE_OPTION_BASE_CLASS_NAME} ${
              asrEngine === "sensevoice_small"
                ? ENGINE_OPTION_SELECTED_CLASS_NAME
                : ENGINE_OPTION_IDLE_CLASS_NAME
            }`}
            disabled={isTranscribing || !sensevoiceAvailable}
            type="button"
            onClick={() => onChangeAsrEngine("sensevoice_small")}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4" aria-hidden="true" />
              SenseVoice（推荐）
            </span>
            <span
              className={getEngineDescriptionClassName(
                asrEngine === "sensevoice_small"
              )}
            >
              {sensevoiceAvailable ? "中文长内容 · 较快" : "当前未启用"}
            </span>
          </button>

          <button
            aria-label="Whisper"
            className={`${ENGINE_OPTION_BASE_CLASS_NAME} ${
              asrEngine === "local_whisper"
                ? ENGINE_OPTION_SELECTED_CLASS_NAME
                : ENGINE_OPTION_IDLE_CLASS_NAME
            }`}
            disabled={isTranscribing}
            type="button"
            onClick={() => onChangeAsrEngine("local_whisper")}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <HardDrive className="h-4 w-4" aria-hidden="true" />
              Whisper
            </span>
            <span
              className={getEngineDescriptionClassName(
                asrEngine === "local_whisper"
              )}
            >
              多语言识别 · 较慢
            </span>
          </button>

        </div>
      </div>

      <TranscribeSettingsPanel
        correctionAvailable={correctionAvailable}
        disabled={isTranscribing || selectedEngineUnavailable}
        isAlwaysOpen
        settings={settings}
        onChange={onChange}
      />
    </ModalDialog>
  );
}
