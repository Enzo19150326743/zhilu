import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { AiTabs } from "./AiTabs";
import { FormatSelector } from "./FormatSelector";
import { LandingHero } from "./LandingHero";
import { RecentLibrary } from "./RecentLibrary";
import { UrlInput } from "./UrlInput";
import { VideoPreviewCard } from "./VideoPreviewCard";
import { isParseResponse } from "@/lib/workbench-detail";
import { getPlatformLabel } from "@/lib/platform-display";
import type { DemoDetail, ParseResponse } from "@/lib/types";

interface HomeWorkspaceProps {
  heroProps: ComponentProps<typeof LandingHero>;
  libraryProps: ComponentProps<typeof RecentLibrary>;
}

export function HomeWorkspace({
  heroProps,
  libraryProps
}: HomeWorkspaceProps) {
  return (
    <>
      <LandingHero {...heroProps} />
      <RecentLibrary {...libraryProps} />
    </>
  );
}

interface WorkbenchWorkspaceProps {
  aiTabsProps: ComponentProps<typeof AiTabs>;
  detail: DemoDetail | ParseResponse;
  urlInputProps: ComponentProps<typeof UrlInput>;
  onBack: () => void;
}

export function WorkbenchWorkspace({
  aiTabsProps,
  detail,
  urlInputProps,
  onBack
}: WorkbenchWorkspaceProps) {
  const isWideWorkspace = ["transcript", "mindmap"].includes(aiTabsProps.activeTab);
  const durationMinutes = Math.floor(detail.video.duration / 60);
  const durationSeconds = detail.video.duration % 60;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleOverflows, setTitleOverflows] = useState(false);

  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const measure = () => setTitleOverflows(title.scrollHeight > title.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    return () => observer.disconnect();
  }, [detail.video.title]);

  return (
    <>
      <UrlInput {...urlInputProps} />
      <section
        className={`mx-auto min-w-0 px-4 pb-14 pt-2 transition-[max-width] duration-200 sm:px-6 lg:px-10 ${
          isWideWorkspace ? "max-w-[90rem]" : "max-w-[76rem]"
        }`}
      >
        <header className="mb-4 border-b border-[var(--line)] pb-4">
          <div className="flex items-start gap-3">
            <button
              className="mt-0.5 inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
              aria-label="返回首页"
              type="button"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <VideoPreviewCard key={detail.video.video_id} video={detail.video} />
            <div className="min-w-0 flex-1">
              <h1 ref={titleRef} className="line-clamp-2 break-words text-lg font-semibold leading-7 text-[var(--ink)] sm:text-xl [overflow-wrap:anywhere]">
                {detail.video.title}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                <span className="min-w-0 [overflow-wrap:anywhere]">{detail.video.author || "未知作者"}</span>
                <span aria-hidden="true">·</span>
                <span>{getPlatformLabel(detail.video.platform)}</span>
                {detail.video.duration > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="mono">
                      {durationMinutes}:{durationSeconds.toString().padStart(2, "0")}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <details key={detail.video.video_id} className="group mt-3 sm:ml-12">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-[var(--muted-strong)] hover:text-[var(--accent)]">
              来源与下载
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4 space-y-5 border-t border-[var(--line)] pt-4">
              {titleOverflows ? (
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-medium text-[var(--muted)]">原始标题</p>
                  <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--ink-soft)] [overflow-wrap:anywhere]">{detail.video.title}</p>
                </div>
              ) : null}
              {isParseResponse(detail) ? (
                <FormatSelector
                  key={detail.video.video_id}
                  formats={detail.formats ?? []}
                  sourceUrl={!detail.is_placeholder ? detail.source_url : null}
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">推荐内容不提供下载格式。</p>
              )}
            </div>
          </details>
        </header>

        <div className="min-w-0">
          <AiTabs {...aiTabsProps} />
        </div>
      </section>
    </>
  );
}
