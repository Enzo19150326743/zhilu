"use client";

import {
  AlertCircle,
  GitFork,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  RotateCcw
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconActionButton } from "./IconActionButton";
import { TranscribeRequiredState } from "./TranscribeRequiredState";
import type { MindmapMeta, SummaryDisplayState } from "@/lib/types";

interface MindmapTabProps {
  canTranscribe: boolean;
  hasTranscript: boolean;
  isTranscribing: boolean;
  mindmapMarkdown: string | null;
  mindmapMeta?: MindmapMeta | null;
  summaryDisplayState: SummaryDisplayState;
  textSourceType?: string | null;
  transcribeErrorMessage: string | null;
  onTranscribe: () => void;
}

type RenderState = "idle" | "loading" | "ready" | "error";

interface MarkmapInstance {
  destroy: () => void;
  fit: () => Promise<void>;
}

export function MindmapTab({
  canTranscribe,
  hasTranscript,
  isTranscribing,
  mindmapMarkdown,
  mindmapMeta,
  summaryDisplayState,
  textSourceType,
  transcribeErrorMessage,
  onTranscribe
}: MindmapTabProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markmapRef = useRef<MarkmapInstance | null>(null);
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const normalizedMarkdown = mindmapMarkdown?.trim() ?? "";
  const isShownotes = mindmapMeta?.text_source_type === "shownotes";
  const needsTranscription = !hasTranscript || textSourceType === "shownotes";

  useEffect(() => {
    if (!normalizedMarkdown || !svgRef.current) {
      setRenderState("idle");
      return;
    }

    let isCancelled = false;
    let markmap: MarkmapInstance | null = null;

    async function renderMindmap() {
      setRenderState("loading");
      setRenderError(null);

      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import("markmap-lib"),
          import("markmap-view")
        ]);
        if (isCancelled || !svgRef.current) {
          return;
        }

        const transformer = new Transformer();
        const { root } = transformer.transform(normalizedMarkdown);
        svgRef.current.replaceChildren();
        markmap = Markmap.create(
          svgRef.current,
          {
            // NOTE: 只在初次渲染后手动 fit，节点展开时保留用户当前视角。
            autoFit: false,
            duration: 220,
            fitRatio: 0.96,
            initialExpandLevel: 3,
            maxInitialScale: 1.5,
            maxWidth: 320,
            paddingX: 14,
            spacingHorizontal: 84,
            spacingVertical: 10
          },
          root
        ) as MarkmapInstance;
        markmapRef.current = markmap;
        await markmap.fit();

        if (!isCancelled) {
          setRenderState("ready");
        }
      } catch {
        if (!isCancelled) {
          setRenderState("error");
          setRenderError("导图暂时显示失败，请稍后再试。");
        }
      }
    }

    void renderMindmap();

    return () => {
      isCancelled = true;
      markmap?.destroy();
      if (markmapRef.current === markmap) {
        markmapRef.current = null;
      }
    };
  }, [normalizedMarkdown]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const fitTimer = window.setTimeout(() => {
      void markmapRef.current?.fit();
    }, 120);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(fitTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded]);

  const handleReset = () => {
    void markmapRef.current?.fit();
  };

  if (summaryDisplayState === "empty") {
    if (needsTranscription) {
      return (
        <div className="space-y-4">
          <TranscribeRequiredState
            canTranscribe={canTranscribe}
            description="需要先生成转写稿，完成后会继续整理总结和结构导图。"
            isTranscribing={isTranscribing}
            title="未生成导图"
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
      <div className="flex min-h-[300px] flex-col justify-center rounded-[2px] bg-[var(--paper)] px-6 py-8 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.08)] sm:px-8">
        <span className="inline-flex min-h-8 w-fit items-center rounded-[2px] bg-[var(--paper-raised)] px-3 text-xs font-medium text-[var(--muted)] shadow-[0_8px_20px_rgba(24,24,27,0.06)]">
          等待总结
        </span>
        <h3 className="mt-7 text-balance text-3xl font-semibold tracking-normal text-[var(--ink)] sm:text-4xl">
          未生成导图
        </h3>
        <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-[var(--muted)] sm:text-base">
          生成完整逐字稿并完成总结后，将自动整理为结构导图。
        </p>
      </div>
    );
  }

  if (!normalizedMarkdown) {
    return (
      <div className="rounded-[2px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] p-6 text-sm text-[var(--muted)]">
        暂无导图内容。
      </div>
    );
  }

  return (
    <div
      className={
        isExpanded
          ? "fixed inset-5 z-50 overflow-hidden border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-4 shadow-[8px_8px_0_0_var(--ink)]"
          : "space-y-4"
      }
    >
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <GitFork className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          树状导图
        </div>

        {isShownotes ? (
          <div className="rounded-[2px] border border-[var(--line-ink)] bg-[var(--accent-soft)] px-3 py-2 text-xs leading-5 text-[var(--ink)]">
            公开笔记不是完整音频逐字稿。
          </div>
        ) : null}
      </section>

      <section className="relative overflow-hidden rounded-[2px] border border-[var(--line-strong)] bg-[#fbfbf8]">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 bg-[var(--paper-raised)]/95 p-1 backdrop-blur">
          <IconActionButton
            disabled={renderState !== "ready"}
            icon={RotateCcw}
            label="重置导图视图"
            onClick={handleReset}
            tooltipSide="bottom"
          />
          <IconActionButton
            icon={isExpanded ? Minimize2 : Maximize2}
            label={isExpanded ? "退出全屏导图" : "全屏查看导图"}
            pressed={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
            tooltipSide="bottom"
          />
        </div>

        <svg
          aria-label="智能树状导图"
          className={isExpanded ? "h-[calc(100vh-9.5rem)] w-full" : "h-[520px] w-full"}
          ref={svgRef}
        />

        {renderState === "ready" ? (
          <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-[2px] bg-[var(--paper-raised)]/90 px-2.5 py-1.5 text-[11px] text-[var(--muted)] shadow-sm backdrop-blur">
            <Move className="h-3.5 w-3.5" aria-hidden="true" />
            拖拽平移，滚轮缩放，点击节点展开或收起
          </div>
        ) : null}

        {renderState === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-raised)]/70 text-sm font-medium text-[var(--muted-strong)] backdrop-blur-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            正在整理导图
          </div>
        ) : null}

        {renderState === "error" && renderError ? (
          <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-[2px] border border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-xs text-[#7a4a1f] shadow-sm">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {renderError}
          </div>
        ) : null}
      </section>
    </div>
  );
}
