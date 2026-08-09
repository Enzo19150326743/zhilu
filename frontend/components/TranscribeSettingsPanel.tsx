"use client";

import { ChevronDown, Plus, Settings2, Trash2, Users } from "lucide-react";
import {
  addEmptySpeaker,
  buildDefaultSpeakers,
  CONTENT_TAG_OPTIONS,
  getMaxSpeakerCount,
  normalizeTranscribeSettings,
  PROGRAM_STRUCTURE_OPTIONS
} from "@/lib/transcribe-settings";
import type {
  TranscribeContextSettings,
  TranscribeSpeakerProfile
} from "@/lib/types";
import { CorrectionTermSelector } from "./CorrectionTermSelector";

interface TranscribeSettingsPanelProps {
  disabled?: boolean;
  isAlwaysOpen?: boolean;
  correctionAvailable?: boolean;
  correctionMessage?: string | null;
  settings: TranscribeContextSettings;
  onChange: (settings: TranscribeContextSettings) => void;
}

type SpeakerField = keyof TranscribeSpeakerProfile;

export function TranscribeSettingsPanel({
  disabled = false,
  isAlwaysOpen = false,
  correctionAvailable = false,
  correctionMessage,
  settings,
  onChange
}: TranscribeSettingsPanelProps) {
  const normalizedSettings = normalizeTranscribeSettings(settings);
  const selectedTags = new Set(normalizedSettings.content_tags);
  const maxSpeakerCount = getMaxSpeakerCount();

  const updateProgramStructure = (programStructure: string) => {
    onChange({
      ...normalizedSettings,
      program_structure: programStructure,
      speakers: buildDefaultSpeakers(programStructure)
    });
  };

  const toggleContentTag = (tag: string) => {
    const nextTags = selectedTags.has(tag)
      ? normalizedSettings.content_tags.filter((item) => item !== tag)
      : [...normalizedSettings.content_tags, tag];
    onChange({
      ...normalizedSettings,
      content_tags: nextTags
    });
  };

  const updateSpeaker = (
    speakerIndex: number,
    field: SpeakerField,
    value: string
  ) => {
    onChange({
      ...normalizedSettings,
      speakers: normalizedSettings.speakers.map((speaker, index) =>
        index === speakerIndex ? { ...speaker, [field]: value } : speaker
      )
    });
  };

  const removeSpeaker = (speakerIndex: number) => {
    onChange({
      ...normalizedSettings,
      speakers: normalizedSettings.speakers.filter((_, index) => index !== speakerIndex)
    });
  };

  const content = (
    <div className={isAlwaysOpen ? "space-y-4" : "mt-3 space-y-4"}>
      <p className="text-xs leading-5 text-[var(--muted)]">
        用于改善标点、断句和访谈稿整理。不确定说话人时，系统不会强行标注。
      </p>

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--muted)]">节目结构</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {PROGRAM_STRUCTURE_OPTIONS.map((option) => {
            const isSelected = normalizedSettings.program_structure === option.value;

            return (
              <button
                className={`min-h-9 rounded-[2px] border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? "border-[var(--line-ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                }`}
                disabled={disabled}
                key={option.value}
                type="button"
                onClick={() => updateProgramStructure(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--muted)]">内容标签</p>
        <div className="flex flex-wrap gap-2">
          <button
            className={`inline-flex h-8 items-center rounded-[2px] border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              normalizedSettings.content_tags.length === 0
                ? "border-[var(--line-ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--muted-strong)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            }`}
            disabled={disabled}
            type="button"
            onClick={() => onChange({ ...normalizedSettings, content_tags: [] })}
          >
            自动判断
          </button>
          {CONTENT_TAG_OPTIONS.map((option) => {
            const isSelected = selectedTags.has(option.value);

            return (
              <button
                className={`inline-flex h-8 items-center rounded-[2px] border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? "border-[var(--line-ink)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--muted-strong)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                }`}
                disabled={disabled}
                key={option.value}
                type="button"
                onClick={() => toggleContentTag(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {isAlwaysOpen ? (
        <CorrectionTermSelector
          correctionAvailable={correctionAvailable}
          correctionMessage={correctionMessage}
          disabled={disabled}
          selectedTerms={normalizedSettings.correction_terms}
          onChange={(correctionTerms) =>
            onChange({
              ...normalizedSettings,
              correction_terms: correctionTerms
            })
          }
        />
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
            <Users className="h-3.5 w-3.5" />
            说话人
          </p>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 text-xs font-medium text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              disabled || normalizedSettings.speakers.length >= maxSpeakerCount
            }
            type="button"
            onClick={() =>
              onChange({
                ...normalizedSettings,
                speakers: addEmptySpeaker(normalizedSettings.speakers)
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>

        {normalizedSettings.speakers.length > 0 ? (
          <div className="grid gap-2">
            {normalizedSettings.speakers.map((speaker, index) => (
              <div
                className="grid gap-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] p-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_36px]"
                key={`speaker-${index}`}
              >
                <input
                  className="h-9 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
                  disabled={disabled}
                  maxLength={80}
                  placeholder="名称"
                  value={speaker.name ?? ""}
                  onChange={(event) =>
                    updateSpeaker(index, "name", event.target.value)
                  }
                />
                <input
                  className="h-9 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
                  disabled={disabled}
                  maxLength={80}
                  placeholder="身份"
                  value={speaker.role ?? ""}
                  onChange={(event) =>
                    updateSpeaker(index, "role", event.target.value)
                  }
                />
                <input
                  className="h-9 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
                  disabled={disabled}
                  maxLength={300}
                  placeholder="职责或立场"
                  value={speaker.description ?? ""}
                  onChange={(event) =>
                    updateSpeaker(index, "description", event.target.value)
                  }
                />
                <button
                  aria-label={`删除说话人 ${index + 1}`}
                  className="inline-flex h-9 items-center justify-center rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--muted)] transition-colors hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled}
                  type="button"
                  onClick={() => removeSpeaker(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--muted)]">
            可不填写，系统会按内容自动整理。
          </div>
        )}
      </div>
    </div>
  );

  if (isAlwaysOpen) {
    return content;
  }

  return (
    <details className="group border-t border-[var(--line-strong)] pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--ink)]">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[var(--muted)]" />
          转写设置
        </span>
        <ChevronDown className="h-4 w-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
      </summary>
      {content}
    </details>
  );
}
