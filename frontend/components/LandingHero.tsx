import {
  Link2,
  Loader2,
  Search
} from "lucide-react";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import type { DemoItem } from "@/lib/types";

interface LandingHeroProps {
  demos: DemoItem[];
  errorMessage: string | null;
  isParsing: boolean;
  loadingDemoId: string | null;
  url: string;
  onAnalyze: (forceRefresh?: boolean) => void;
  onChangeUrl: (value: string) => void;
  onLoadDemo: (demoId: string) => void;
}

const workflowItems = [
  {
    number: "01",
    title: "接收链接"
  },
  {
    number: "02",
    title: "取得文本"
  },
  {
    number: "03",
    title: "提炼内容"
  },
  {
    number: "04",
    title: "本地沉淀"
  }
];

const recommendationFallbacks: Record<string, string> = {
  ai_talk_001: "/demo-covers/ai-talk.svg",
  product_course_001: "/demo-covers/product-course.svg",
  tech_podcast_001: "/demo-covers/tech-podcast.svg"
};

interface RecommendationDeckProps {
  items: DemoItem[];
  loadingItemId: string | null;
  onOpenItem: (itemId: string) => void;
}

function RecommendationDeck({
  items,
  loadingItemId,
  onOpenItem
}: RecommendationDeckProps) {
  return (
    <div className="editorial-enter editorial-enter-delay-2 min-w-0">
      <div className="mb-2">
        <h2 className="font-editorial text-[28px] font-bold leading-tight text-[var(--ink)]">
          推荐内容
        </h2>
      </div>
      <div className="border-t-2 border-[var(--line-ink)]" aria-hidden="true" />

      <div className="divide-y divide-[var(--line-ink)]">
        {items.slice(0, 3).map((item, index) => {
          const isLoading = loadingItemId === item.demo_id;
          const fallbackThumbnail =
            recommendationFallbacks[item.demo_id] ?? "/demo-covers/ai-talk.svg";
          const thumbnailUrl = getDisplayThumbnailUrl(item.thumbnail);

          return (
            <button
              className="group flex w-full min-w-0 items-center gap-5 py-5 text-left transition-[background-color] duration-150 hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-60 sm:gap-7"
              disabled={loadingItemId !== null}
              key={item.demo_id}
              type="button"
              onClick={() => onOpenItem(item.demo_id)}
            >
              <span className="mono w-8 shrink-0 text-[13px] font-medium text-[var(--accent)]">
                0{index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-editorial block truncate text-lg font-semibold leading-7 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)] sm:text-[22px] sm:leading-[30px]">
                  {item.title}
                </span>
                <span className="mt-2 block truncate text-xs leading-[18px] text-[var(--muted)]">
                  {item.description}
                </span>
              </span>
              {isLoading ? (
                <Loader2
                  className="h-5 w-5 shrink-0 animate-spin text-[var(--accent)]"
                  aria-hidden="true"
                />
              ) : null}
              <span className="shadow-hard-sm hidden aspect-video w-[168px] shrink-0 overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--ink)] sm:block">
                <img
                  alt={`${item.title} 媒体封面`}
                  className="h-full w-full object-contain"
                  referrerPolicy="no-referrer"
                  src={thumbnailUrl || fallbackThumbnail}
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = fallbackThumbnail;
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-[var(--line-ink)]" aria-hidden="true" />
    </div>
  );
}

export function LandingHero({
  demos,
  errorMessage,
  isParsing,
  loadingDemoId,
  url,
  onAnalyze,
  onChangeUrl,
  onLoadDemo
}: LandingHeroProps) {
  return (
    <>
      <section className="bg-[var(--paper)]">
        <div className="mx-auto max-w-[90rem] px-4 pb-12 pt-8 sm:px-6 lg:px-10 lg:pb-14 lg:pt-10">
          <div className="flex items-start gap-9">
            <div className="min-w-0 flex-1">
              <div className="editorial-enter">
                <span className="shadow-hard-sm mono inline-block rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent)] px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--paper-raised)]">
                  FEATURE · 从链接到知识稿
                </span>
              </div>

              <h1 className="editorial-enter editorial-enter-delay-1 mt-7 text-balance text-[clamp(2.6rem,6vw,5.25rem)] font-bold leading-[1.12] tracking-[-0.01em] text-[var(--ink)]">
                <span className="font-editorial block">看见的，听见的，</span>
                <span className="font-editorial mt-2 block">
                  <span className="shadow-hard-md inline-block rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent)] px-1 text-[var(--paper-raised)]">
                    都变成你的知识。
                  </span>
                </span>
              </h1>

              <p className="editorial-enter editorial-enter-delay-2 mt-7 max-w-3xl whitespace-nowrap text-[15px] leading-[26px] text-[var(--ink-soft)]">
                从公开视频与播客取得文本，整理为摘要、导图与摘录，导出可继续编辑的本地 Markdown 知识稿。
              </p>

              <div className="editorial-enter editorial-enter-delay-2 mt-9 max-w-[672px]">
                <div className="shadow-hard-sm flex min-h-[52px] min-w-0 items-stretch rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)]">
                  <div className="relative min-w-0 flex-1">
                    <Link2
                      className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--muted)]"
                      aria-hidden="true"
                    />
                    <input
                      aria-label="公开媒体链接"
                      className="font-editorial min-h-[52px] w-full border-0 bg-transparent pl-11 pr-3 text-lg text-[var(--ink)] outline-none placeholder:text-[#a39a87] focus-visible:outline-none disabled:cursor-not-allowed"
                      inputMode="url"
                      placeholder="粘贴 B 站 / 小宇宙 / 抖音公开链接…"
                      type="url"
                      value={url}
                      onChange={(event) => onChangeUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          onAnalyze(false);
                        }
                      }}
                    />
                  </div>
                  <button
                    className="inline-flex min-h-[52px] shrink-0 items-center justify-center gap-2 border-l-2 border-[var(--line-ink)] bg-[var(--accent-light)] px-4 text-[15px] font-semibold text-[var(--paper-raised)] transition-colors duration-150 hover:bg-[var(--accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-100"
                    disabled={isParsing || !url.trim()}
                    type="button"
                    onClick={() => onAnalyze(false)}
                  >
                    {isParsing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Search className="h-4 w-4" aria-hidden="true" />
                    )}
                    {isParsing ? "提取中" : "生成知识稿"}
                  </button>
                </div>

                {errorMessage ? (
                  <div className="shadow-hard-sm mt-4 rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--ink)]">
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[90rem] px-4 pb-6 pt-10 sm:px-6 lg:px-10">
          <div className="grid grid-cols-1 gap-[2px] border-y-2 border-[var(--line-ink)] bg-[var(--line-ink)] sm:grid-cols-2 lg:grid-cols-4">
            {workflowItems.map((item) => (
              <div className="bg-[var(--paper)] px-6 py-6" key={item.number}>
                <p
                  className={`font-editorial text-[28px] font-bold leading-none ${
                    item.number === "01"
                      ? "text-[var(--accent)]"
                      : "text-[var(--ink)]"
                  }`}
                >
                  {item.number}
                </p>
                <p className="mt-3 text-sm font-semibold text-[var(--ink)]">
                  {item.title}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--paper)]">
        <div className="mx-auto max-w-[90rem] px-4 pb-16 pt-10 sm:px-6 lg:px-10">
          <RecommendationDeck
            items={demos}
            loadingItemId={loadingDemoId}
            onOpenItem={onLoadDemo}
          />
        </div>
      </section>
    </>
  );
}
