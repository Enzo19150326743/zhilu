"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Settings2, Trash2 } from "lucide-react";
import {
  addEmptySpeaker,
  CONTENT_TAG_OPTIONS,
  getMaxSpeakerCount,
  normalizeTranscribeSettings,
  PROGRAM_STRUCTURE_OPTIONS,
  updateSpeakersForProgramStructure
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
  settings: TranscribeContextSettings;
  onChange: (settings: TranscribeContextSettings) => void;
}

type SpeakerField = keyof TranscribeSpeakerProfile;

export function TranscribeSettingsPanel({
  disabled = false,
  isAlwaysOpen = false,
  correctionAvailable = false,
  settings,
  onChange
}: TranscribeSettingsPanelProps) {
  const supplementId = useId();
  const [isSupplementOpen, setIsSupplementOpen] = useState(false);
  const speakerSectionRef = useRef<HTMLDivElement>(null);
  const shouldFocusSpeakerRef = useRef(false);
  const normalizedSettings = normalizeTranscribeSettings(settings);
  const selectedTags = new Set(normalizedSettings.content_tags);
  const maxSpeakerCount = getMaxSpeakerCount();
  const conversationStructureLabel =
    normalizedSettings.program_structure === "interview"
      ? "双人访谈"
      : normalizedSettings.program_structure === "roundtable"
        ? "多人节目"
        : null;

  useEffect(() => {
    if (!isSupplementOpen || !shouldFocusSpeakerRef.current) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      speakerSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
      speakerSectionRef.current
        ?.querySelector<HTMLInputElement>('input[data-speaker-name="true"]')
        ?.focus();
      shouldFocusSpeakerRef.current = false;
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isSupplementOpen, normalizedSettings.speakers.length]);

  const updateProgramStructure = (programStructure: string) => {
    onChange({
      ...normalizedSettings,
      program_structure: programStructure,
      speakers: updateSpeakersForProgramStructure(
        normalizedSettings.program_structure,
        normalizedSettings.speakers,
        programStructure
      )
    });
  };

  const openSupplementForSpeakers = () => {
    shouldFocusSpeakerRef.current = true;
    setIsSupplementOpen(true);
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
        {conversationStructureLabel ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-l-4 border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--ink-soft)]">
              已按{conversationStructureLabel}识别
            </span>
            <button
              aria-controls={supplementId}
              className="text-xs font-semibold text-[var(--accent)] underline decoration-1 underline-offset-4 transition-colors hover:text-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              type="button"
              onClick={openSupplementForSpeakers}
            >
              补充说话人（可选）
            </button>
          </div>
        ) : null}
      </div>

      {isAlwaysOpen ? (
        <CorrectionTermSelector
          correctionAvailable={correctionAvailable}
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

      <details
        className="group/supplement rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] shadow-[4px_4px_0_0_var(--accent)]"
        id={supplementId}
        open={isSupplementOpen}
        onToggle={(event) => setIsSupplementOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-sm font-semibold text-[var(--ink)]">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 bg-[var(--accent)]"
            />
            补充识别信息
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-strong)]">
              {normalizedSettings.speakers.length > 0
                ? `${normalizedSettings.speakers.length} 位说话人`
                : "可选"}
            </span>
            <ChevronDown className="h-4 w-4 text-[var(--ink)] transition-transform group-open/supplement:rotate-180" />
          </span>
        </summary>

        <div className="space-y-4 border-t-2 border-[var(--line-ink)] bg-[var(--paper)] p-3.5">
          <div
            className="space-y-3 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-3"
            ref={speakerSectionRef}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--ink)]">
                <span>说话人</span>
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  可不填
                </span>
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
                添加说话人
              </button>
            </div>

            {normalizedSettings.speakers.length > 0 ? (
              <div className="grid gap-2">
                {normalizedSettings.speakers.map((speaker, index) => (
                  <div
                    className="grid gap-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_36px]"
                    key={`speaker-${index}`}
                  >
                    <input
                      aria-label={`说话人 ${index + 1} 姓名`}
                      className="h-9 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
                      data-speaker-name="true"
                      disabled={disabled}
                      maxLength={80}
                      placeholder="姓名（如知道）"
                      value={speaker.name ?? ""}
                      onChange={(event) =>
                        updateSpeaker(index, "name", event.target.value)
                      }
                    />
                    <input
                      aria-label={`说话人 ${index + 1} 身份`}
                      className="h-9 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 text-sm text-[var(--ink-soft)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)]"
                      disabled={disabled}
                      maxLength={80}
                      placeholder="身份（如主持人）"
                      value={speaker.role ?? ""}
                      onChange={(event) =>
                        updateSpeaker(index, "role", event.target.value)
                      }
                    />
                    <input
                      aria-label={`说话人 ${index + 1} 职责或立场`}
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
            ) : null}
          </div>

          <div className="space-y-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-3">
            <p className="text-xs font-semibold text-[var(--ink-soft)]">内容标签</p>
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
        </div>
      </details>
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
