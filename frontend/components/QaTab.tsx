"use client";

import {
  CircleAlert,
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

interface QaTabProps {
  canTranscribe: boolean;
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
  const hasContentText = Boolean(transcript?.plain_text.trim());
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

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">问答模式</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              基于当前内容文本回答，无法从文本确认的信息会明确说明无法确定。
            </p>
          </div>
          <div className="grid grid-cols-2 rounded-lg border border-zinc-200 bg-white p-1">
            {qaModes.map((mode) => {
              const Icon = mode.icon;
              const isActive = activeMode === mode.key;

              return (
                <button
                  className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                    isActive
                      ? "bg-zinc-950 text-white shadow-sm"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
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

        <div className="mt-3 rounded-lg border border-zinc-200 bg-white px-3 py-2">
          <p className="text-xs font-medium text-zinc-500">当前模式</p>
          <p className="mt-1 text-sm font-semibold text-zinc-950">
            {activeModeDetail.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {activeModeDetail.description}
          </p>
        </div>
      </section>

      {!canAsk ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
          <div className="flex gap-2">
            <CircleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                {isShownotes
                  ? "当前只有 shownotes 原文。"
                  : "当前没有可用于问答的内容文本。"}
              </p>
              <p className="mt-1 text-amber-800">
                {isShownotes
                  ? "必须先生成转写稿，才能基于完整逐字稿进行内容问答。"
                  : "可先生成转写稿，再继续提问。"}
              </p>
              {canTranscribe ? (
                <button
                  className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950"
                  disabled={isTranscribing}
                  type="button"
                  onClick={onTranscribe}
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isTranscribing ? "生成中" : "生成转写稿"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {transcribeErrorMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {transcribeErrorMessage}
        </div>
      ) : null}

      <form className="flex gap-2" onSubmit={handleAsk}>
        <input
          className="h-11 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
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
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-950 text-white transition hover:bg-blue-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {errorMessage}
        </div>
      ) : null}

      {answer ? (
        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-zinc-950">回答</h3>
            <span
              className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium ${
                answer.is_ai_generated
                  ? "bg-blue-50 text-blue-700"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {answer.is_ai_generated
                ? "智能回答已生成"
                : "本地参考已生成"}
            </span>
          </div>
          <p className="text-sm leading-6 text-zinc-700">{answer.answer}</p>

          {answer.references.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                引用片段
              </h4>
              <div className="mt-2 space-y-2">
                {answer.references.map((reference, index) => (
                  <div
                    className="flex gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-700"
                    key={`${reference.time ?? "content"}-${index}`}
                  >
                    <Quote
                      className="mt-1 h-4 w-4 shrink-0 text-zinc-500"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-xs font-medium text-zinc-500">
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
