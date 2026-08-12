"use client";

import {
  Gauge,
  Lightbulb,
  Loader2,
  Quote,
  SendHorizontal
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiClientError, apiClient } from "@/lib/api";
import type {
  QaMode,
  QaResponse,
  TranscriptPayload,
  VideoSummary
} from "@/lib/types";
import { TranscribeRequiredState } from "./TranscribeRequiredState";

interface QaTabProps {
  canTranscribe: boolean;
  hasTranscript: boolean;
  isTranscribing: boolean;
  mediaType?: string | null;
  sourceUrl?: string | null;
  summary: VideoSummary | null;
  textSourceType?: string | null;
  transcribeErrorMessage: string | null;
  transcript: TranscriptPayload | null;
  videoAuthor?: string | null;
  videoTitle?: string | null;
  onQaComplete?: () => void;
  onTranscribe: () => void;
}

const qaModes: Array<{
  key: QaMode;
  label: string;
  description: string;
  icon: typeof Gauge;
}> = [
  {
    key: "fast",
    label: "快速",
    description: "优先响应速度，适合快速追问和粗略判断。",
    icon: Gauge
  },
  {
    key: "thinking",
    label: "思考",
    description: "优先推理质量，适合复杂问题和深度归纳。",
    icon: Lightbulb
  }
];

const suggestedQuestions = [
  "这段内容的核心结论是什么？",
  "作者给出了哪些可执行建议？",
  "有哪些观点需要进一步核实？"
];

function getQaErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return "问答服务还没有响应。请重启后端服务。";
    }

    if (error.errorCode === "TRANSCRIPT_EMPTY") {
      return "当前记录没有可用于问答的内容文本。可以先生成转写稿，再继续提问。";
    }

    if (error.errorCode === "RATE_LIMITED") {
      return error.message;
    }

    if (error.errorCode === "NETWORK_ERROR") {
      return error.message;
    }

    if (error.errorCode === "TIMEOUT") {
      return "问答请求超时。远程服务响应慢或后端忙时可能发生，可以稍后重试。";
    }

    if (error.status === 422) {
      return "问答请求参数和后端版本不一致。请刷新页面并重启后端后再试。";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "问答生成失败，请稍后重试。";
}

export function QaTab({
  canTranscribe,
  hasTranscript,
  isTranscribing,
  mediaType,
  sourceUrl,
  summary,
  textSourceType,
  transcribeErrorMessage,
  transcript,
  videoAuthor,
  videoTitle,
  onQaComplete,
  onTranscribe
}: QaTabProps) {
  const [activeMode, setActiveMode] = useState<QaMode>("fast");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<QaResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const activeModeDetail =
    qaModes.find((mode) => mode.key === activeMode) ?? qaModes[0];
  const hasContentText = hasTranscript && Boolean(transcript?.plain_text.trim());
  const isShownotes = textSourceType === "shownotes";
  const canAsk = hasContentText && !isShownotes;

  const handleAsk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setErrorMessage("请输入要询问的问题。");
      return;
    }

    if (!transcript?.plain_text.trim()) {
      setErrorMessage("当前没有可用于问答的内容文本。");
      return;
    }

    if (isShownotes) {
      setErrorMessage("当前只有 shownotes 原文，请先生成转写稿，再基于完整逐字稿提问。");
      return;
    }

    setIsAsking(true);
    setErrorMessage(null);
    setAnswer(null);

    try {
      const response = await apiClient.askQuestion({
        media_type: mediaType,
        mode: activeMode,
        question: trimmedQuestion,
        source_url: sourceUrl ?? undefined,
        summary_tldr: summary?.tldr,
        text_source_type: textSourceType,
        timeline: summary?.timeline,
        transcript_plain_text: transcript.plain_text,
        video_author: videoAuthor ?? undefined,
        video_title: videoTitle ?? undefined
      });
      setAnswer(response);
    } catch (error) {
      setErrorMessage(getQaErrorMessage(error));
    } finally {
      setIsAsking(false);
      onQaComplete?.();
    }
  };

  if (!canAsk) {
    return (
      <div className="space-y-4">
        <TranscribeRequiredState
          canTranscribe={canTranscribe}
          description={
            isShownotes
              ? "当前只有 shownotes，需要先生成完整转写稿，再基于音频内容问答。"
              : "需要先生成转写稿，再继续进行内容问答。"
          }
          isTranscribing={isTranscribing}
          title="暂不能进行内容问答"
          onTranscribe={onTranscribe}
        />
        {transcribeErrorMessage ? (
          <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
            {transcribeErrorMessage}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">问答模式</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              仅根据当前内容回答，不确定处会说明。
            </p>
          </div>
          <div className="grid grid-cols-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-1">
            {qaModes.map((mode) => {
              const Icon = mode.icon;
              const isActive = activeMode === mode.key;

              return (
                <button
                  className={`inline-flex h-9 items-center justify-center gap-2 rounded-[2px] px-3 text-sm font-medium transition ${
                    isActive
                      ? "bg-[var(--ink)] text-[var(--paper)] shadow-sm"
                      : "text-[var(--muted-strong)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
                  key={mode.key}
                  type="button"
                  onClick={() => setActiveMode(mode.key)}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-3 border-t border-[var(--line-strong)] pt-3 text-xs leading-5 text-[var(--muted)]">
          {activeModeDetail.description}
        </p>
      </section>

      {transcribeErrorMessage ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
          {transcribeErrorMessage}
        </div>
      ) : null}

      {canAsk && !answer ? (
        <section>
          <h3 className="text-xs font-semibold text-[var(--muted)]">可以先问</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestedQuestions.map((suggestedQuestion) => (
              <button
                className="border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 text-left text-xs text-[var(--ink-soft)] transition-[background-color,color,border-color] hover:border-[var(--line-ink)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                key={suggestedQuestion}
                type="button"
                onClick={() => setQuestion(suggestedQuestion)}
              >
                {suggestedQuestion}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <form
        className="sticky bottom-3 z-10 flex gap-2 border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-2 shadow-[3px_3px_0_0_var(--ink)]"
        onSubmit={handleAsk}
      >
        <input
          className="focus-subtle h-11 flex-1 border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-ink)] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)] disabled:text-[var(--muted)]"
          disabled={!canAsk || isAsking}
          placeholder={
            isShownotes
              ? "请先生成转写稿后提问"
              : `使用${activeModeDetail.label}模式向内容提问...`
          }
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          className="inline-flex h-11 w-11 items-center justify-center rounded-[2px] border border-[var(--line-strong)] bg-[var(--ink)] text-[var(--paper)] transition hover:bg-[var(--accent-deep)] active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)] disabled:text-[var(--muted)]"
          disabled={!canAsk || isAsking || !question.trim()}
          type="submit"
          title="发送问题"
        >
          {isAsking ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>

      {errorMessage ? (
        <div className="rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
          {errorMessage}
        </div>
      ) : null}

      {answer ? (
        <section className="space-y-3 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-[var(--ink)]">回答</h3>
            <span
              className={`inline-flex min-h-8 items-center rounded-[2px] px-3 text-xs font-medium ${
                answer.is_ai_generated
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "bg-[#f7ead9] text-[#7a4a1f]"
              }`}
            >
              {answer.is_ai_generated
                ? "智能回答已生成"
                : "本地参考已生成"}
            </span>
          </div>
          <p className="text-sm leading-6 text-[var(--ink-soft)]">{answer.answer}</p>

          {answer.references.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                引用片段
              </h4>
              <div className="mt-2 space-y-2">
                {answer.references.map((reference, index) => (
                  <div
                    className="flex gap-2 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-sm leading-6 text-[var(--ink-soft)]"
                    key={`${reference.time ?? "content"}-${index}`}
                  >
                    <Quote
                      className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)]">
                        {reference.time ?? "内容文本"}
                      </p>
                      <p className="mt-1">{reference.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
