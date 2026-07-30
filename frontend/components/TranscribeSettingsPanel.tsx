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
      <p className="text-xs leading-5 text-zinc-500">
        用于改善标点、断句和访谈稿整理。不确定说话人时，系统不会强行标注。
      </p>

      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-500">节目结构</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {PROGRAM_STRUCTURE_OPTIONS.map((option) => {
            const isSelected = normalizedSettings.program_structure === option.value;

            return (
              <button
                className={`min-h-9 rounded-lg border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
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
        <p className="text-xs font-medium text-zinc-500">内容标签</p>
        <div className="flex flex-wrap gap-2">
          <button
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              normalizedSettings.content_tags.length === 0
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950"
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
                className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950"
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
          <p className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500">
            <Users className="h-3.5 w-3.5" />
            说话人
          </p>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_36px]"
                key={`speaker-${index}`}
              >
                <input
                  className="h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-800 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-100"
                  disabled={disabled}
                  maxLength={80}
                  placeholder="名称"
                  value={speaker.name ?? ""}
                  onChange={(event) =>
                    updateSpeaker(index, "name", event.target.value)
                  }
                />
                <input
                  className="h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-800 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-100"
                  disabled={disabled}
                  maxLength={80}
                  placeholder="身份"
                  value={speaker.role ?? ""}
                  onChange={(event) =>
                    updateSpeaker(index, "role", event.target.value)
                  }
                />
                <input
                  className="h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-800 outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-100"
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
                  className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
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
    <details className="group border-t border-zinc-200 pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-950">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-zinc-500" />
          转写设置
        </span>
        <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" />
      </summary>
      {content}
    </details>
  );
}
