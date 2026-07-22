"use client";

import { AlertCircle, GitFork, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MindmapMeta, SummaryDisplayState } from "@/lib/types";

interface MindmapTabProps {
  mindmapMarkdown: string | null;
  mindmapMeta?: MindmapMeta | null;
  summaryDisplayState: SummaryDisplayState;
}

type RenderState = "idle" | "loading" | "ready" | "error";

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
    let markmap: { destroy: () => void; fit: () => Promise<void> } | null = null;

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
        );
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
    };
  }, [normalizedMarkdown]);

  if (summaryDisplayState === "empty") {
    return (
      <div className="flex min-h-[300px] flex-col justify-center rounded-2xl bg-zinc-50 px-6 py-8 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.08)] sm:px-8">
        <span className="inline-flex min-h-8 w-fit items-center rounded-full bg-white px-3 text-xs font-medium text-zinc-500 shadow-[0_8px_20px_rgba(24,24,27,0.06)]">
          等待总结
        </span>
        <h3 className="mt-7 text-balance text-3xl font-semibold tracking-normal text-zinc-950 sm:text-4xl">
          未生成导图
        </h3>
        <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-zinc-500 sm:text-base">
          生成完整逐字稿并完成总结后，将自动整理为结构导图。
        </p>
      </div>
    );
  }

  if (!normalizedMarkdown) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
        暂无导图内容。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <GitFork className="h-4 w-4 text-blue-600" aria-hidden="true" />
            树状导图
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {metaItems.map((item) => (
              <span
                className="inline-flex min-h-7 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-600"
                key={item}
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        {isShownotes ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
            公开笔记不是完整音频逐字稿。
          </div>
        ) : null}
      </section>

      <section className="relative overflow-hidden rounded-lg border border-zinc-200 bg-[#fbfbf8]">
        <svg
          aria-label="智能树状导图"
          className="h-[460px] w-full"
          ref={svgRef}
        />

        {renderState === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-medium text-zinc-600 backdrop-blur-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            正在整理导图
          </div>
        ) : null}

        {renderState === "error" && renderError ? (
          <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {renderError}
          </div>
        ) : null}
      </section>
    </div>
  );
}
