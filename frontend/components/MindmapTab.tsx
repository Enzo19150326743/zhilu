"use client";

import {
  AlertCircle,
  GitFork,
  Loader2,
  Maximize2,
  Move,
  RotateCcw,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MindmapMeta, SummaryDisplayState } from "@/lib/types";

interface MindmapTabProps {
  mindmapMarkdown: string | null;
  mindmapMeta?: MindmapMeta | null;
  summaryDisplayState: SummaryDisplayState;
}

type RenderState = "idle" | "loading" | "ready" | "error";

interface MarkmapInstance {
  destroy: () => void;
  fit: () => Promise<void>;
  rescale: (scale: number) => Promise<void> | void;
  setHighlight: (node: unknown | null) => void;
}

const contentCategoryLabels: Record<string, string> = {
  business_tech: "商业科技 / 干货",
  general: "通用内容",
  interview_podcast: "访谈播客",
  self_growth: "自我成长",
  tutorial_howto: "教程方法"
};

const mediaTypeLabels: Record<string, string> = {
  media: "媒体内容",
  podcast: "播客",
  video: "视频"
};

const textSourceLabels: Record<string, string> = {
  content: "内容文本",
  asr_transcript: "转写稿",
  subtitle: "平台字幕",
  shownotes: "公开笔记",
  transcript: "字幕 / 逐字稿"
};

function getMetaLabel(
  labels: Record<string, string>,
  value: string | null | undefined,
  fallback: string
): string {
  if (!value) {
    return fallback;
  }

  return labels[value] ?? fallback;
}

export function MindmapTab({
  mindmapMarkdown,
  mindmapMeta,
  summaryDisplayState
}: MindmapTabProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markmapRef = useRef<MarkmapInstance | null>(null);
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const normalizedMarkdown = mindmapMarkdown?.trim() ?? "";
  const isShownotes = mindmapMeta?.text_source_type === "shownotes";
  const metaItems = useMemo(
    () => [
      getMetaLabel(
        contentCategoryLabels,
        mindmapMeta?.content_category,
        "通用内容"
      ),
      getMetaLabel(mediaTypeLabels, mindmapMeta?.media_type, "媒体内容"),
      getMetaLabel(
        textSourceLabels,
        mindmapMeta?.text_source_type,
        "内容文本"
      )
    ],
    [mindmapMeta]
  );

  useEffect(() => {
    if (!normalizedMarkdown || !svgRef.current) {
      setRenderState("idle");
      return;
    }

    let isCancelled = false;
    let markmap: MarkmapInstance | null = null;
    let handleSvgClick: ((event: MouseEvent) => void) | null = null;

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
        handleSvgClick = (event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof Element)) {
            return;
          }

          const nodeElement = target.closest("g.markmap-node");
          const nodeData = nodeElement
            ? (nodeElement as Element & { __data__?: unknown }).__data__
            : null;
          markmapRef.current?.setHighlight(nodeData ?? null);
        };
        svgRef.current.addEventListener("click", handleSvgClick);
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
      if (svgRef.current && handleSvgClick) {
        svgRef.current.removeEventListener("click", handleSvgClick);
      }
      markmap?.destroy();
      if (markmapRef.current === markmap) {
        markmapRef.current = null;
      }
    };
  }, [normalizedMarkdown]);

  const handleFit = () => {
    void markmapRef.current?.fit();
  };

  const handleReset = () => {
    markmapRef.current?.setHighlight(null);
    void markmapRef.current?.fit();
  };

  const handleZoom = (scale: number) => {
    void markmapRef.current?.rescale(scale);
  };

  if (summaryDisplayState === "empty") {
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
    <div className="space-y-4">
      <section className="flex flex-col gap-3 border-b border-[var(--line-strong)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <GitFork className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
            树状导图
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {metaItems.map((item) => (
              <span
                className="inline-flex min-h-7 items-center rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper)] px-2.5 text-xs font-medium text-[var(--muted-strong)]"
                key={item}
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        {isShownotes ? (
          <div className="rounded-[2px] border border-[var(--line-ink)] bg-[var(--accent-soft)] px-3 py-2 text-xs leading-5 text-[var(--ink)]">
            公开笔记不是完整音频逐字稿。
          </div>
        ) : null}
      </section>

      <section className="relative overflow-hidden rounded-[2px] border border-[var(--line-strong)] bg-[#fbfbf8]">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[2px] border border-[var(--line-strong)] bg-[var(--paper-raised)]/95 p-1 shadow-sm backdrop-blur">
          <button
            aria-label="放大导图"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-[var(--muted-strong)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={renderState !== "ready"}
            title="放大"
            type="button"
            onClick={() => handleZoom(1.2)}
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            aria-label="缩小导图"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-[var(--muted-strong)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={renderState !== "ready"}
            title="缩小"
            type="button"
            onClick={() => handleZoom(0.8)}
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            aria-label="适应导图画布"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-[var(--muted-strong)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={renderState !== "ready"}
            title="适应画布"
            type="button"
            onClick={handleFit}
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            aria-label="重置导图视图"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-[var(--muted-strong)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={renderState !== "ready"}
            title="重置视图"
            type="button"
            onClick={handleReset}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <svg
          aria-label="智能树状导图"
          className="h-[460px] w-full"
          ref={svgRef}
        />

        {renderState === "ready" ? (
          <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-[2px] bg-[var(--paper-raised)]/90 px-2.5 py-1.5 text-[11px] text-[var(--muted)] shadow-sm backdrop-blur">
            <Move className="h-3.5 w-3.5" aria-hidden="true" />
            拖拽画布平移 · 滚轮缩放 · 点击节点高亮或展开
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
