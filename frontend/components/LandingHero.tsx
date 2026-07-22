import {
  ArrowUpRight,
  Link2,
  Loader2,
  Search,
  ShieldCheck
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
    title: "接收链接",
    description: "从视频或播客开始"
  },
  {
    number: "02",
    title: "取得文本",
    description: "字幕、Shownotes 或转写"
  },
  {
    number: "03",
    title: "提炼内容",
    description: "摘要、要点与摘录"
  },
  {
    number: "04",
    title: "本地沉淀",
    description: "形成可编辑的 Markdown 知识稿"
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
      <div className="mb-5 flex items-center gap-4 border-b border-[var(--line-strong)] pb-3">
        <h2 className="font-editorial text-2xl font-semibold text-[var(--ink)] sm:text-3xl">
          推荐内容
        </h2>
        <span className="h-px flex-1 bg-[var(--accent)]/30" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 3).map((item, index) => {
          const isLoading = loadingItemId === item.demo_id;
          const fallbackThumbnail =
            recommendationFallbacks[item.demo_id] ?? "/demo-covers/ai-talk.svg";
          const thumbnailUrl = getDisplayThumbnailUrl(item.thumbnail);

          return (
            <button
              className="archive-sheet group flex h-[330px] min-w-0 flex-col overflow-hidden rounded-[22px] bg-[var(--paper-raised)] text-left transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-1 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loadingItemId !== null}
              key={item.demo_id}
              type="button"
              onClick={() => onOpenItem(item.demo_id)}
            >
              <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-[var(--paper-deep)]">
                <img
                  alt={`${item.title} 媒体封面`}
                  className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 transition-transform duration-300 ease-out group-hover:scale-[1.025]"
                  referrerPolicy="no-referrer"
                  src={thumbnailUrl || fallbackThumbnail}
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = fallbackThumbnail;
                  }}
                />
                <span className="absolute left-3 top-3 inline-flex min-h-7 items-center bg-[rgba(24,23,19,0.86)] px-2.5 text-[10px] font-bold tracking-[0.16em] text-white backdrop-blur-md">
                  推荐 / 0{index + 1}
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4">
                <p className="line-clamp-2 text-base font-semibold leading-6 text-[var(--ink)]">
                  {item.title}
                </p>
                <div className="mt-auto flex items-end justify-between gap-3 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
                  <span className="line-clamp-1">{item.description}</span>
                  {isLoading ? (
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-[var(--accent)] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
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
    <section className="relative overflow-hidden border-b border-[var(--line)] bg-[var(--paper)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_0,transparent_calc(100%-1px),rgba(38,35,29,0.055)_calc(100%-1px)),linear-gradient(to_bottom,transparent_0,transparent_calc(100%-1px),rgba(38,35,29,0.045)_calc(100%-1px))] bg-[size:88px_88px] opacity-60"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-24 h-72 w-72 rounded-full bg-[var(--accent-soft)] blur-3xl"
      />

      <div className="relative mx-auto max-w-[90rem] px-4 py-12 sm:px-6 sm:py-14 lg:px-10 lg:py-14">
        <div className="editorial-enter flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
          <span className="h-px w-10 bg-current" />
          知录 · 本地 Markdown 知识工作台
        </div>

        <h1 className="font-editorial editorial-enter editorial-enter-delay-1 mt-7 text-balance text-[clamp(3.2rem,5.2vw,4.75rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-[var(--ink)] lg:whitespace-nowrap">
          看见的，听见的，
          <span className="text-[var(--accent)]">都变成你的知识。</span>
        </h1>

        <div className="mt-10 grid items-start gap-12 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-14">
          <div className="min-w-0">
            <p className="editorial-enter editorial-enter-delay-2 max-w-xl text-pretty text-base leading-8 text-[var(--muted-strong)] sm:text-lg">
              从视频与播客取得文本，整理成摘要、导图与摘录，沉淀为保存在本地、可继续编辑的 Markdown 知识稿。
            </p>

            <div className="editorial-enter editorial-enter-delay-3 mt-7">
              <div className="link-intake rounded-[24px] bg-[var(--paper-raised)] p-2">
                <label className="block px-3 pb-2 pt-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  公开媒体链接
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Link2
                      className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--muted)]"
                      aria-hidden="true"
                    />
                    <input
                      aria-label="公开媒体链接"
                      className="min-h-14 w-full rounded-[16px] border border-[var(--line-strong)] bg-[var(--paper)] pl-12 pr-4 text-sm text-[var(--ink)] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[var(--muted)] hover:border-[var(--ink-soft)] focus:border-[var(--accent)] focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:cursor-not-allowed sm:text-base"
                      inputMode="url"
                      placeholder="粘贴 B 站 / 小宇宙 / 抖音公开链接"
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
                    className="inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-[16px] bg-[var(--ink)] pl-5 pr-[18px] text-sm font-semibold text-[var(--paper-raised)] transition-[background-color,scale] duration-150 ease-out hover:bg-[var(--accent)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[var(--ink)] sm:min-w-36"
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
              </div>

              {errorMessage ? (
                <div className="mt-4 border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--ink)]">
                  {errorMessage}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--muted)]">
                <span>B 站</span>
                <span aria-hidden="true">/</span>
                <span>小宇宙</span>
                <span aria-hidden="true">/</span>
                <span>抖音</span>
                <span className="inline-flex items-center gap-1.5 text-[var(--muted-strong)]">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  结果保存在本地
                </span>
              </div>
            </div>

            <div className="editorial-enter editorial-enter-delay-3 mt-8 grid border-y border-[var(--line-strong)] sm:grid-cols-2">
              {workflowItems.map((item, index) => (
                <div
                  className={`grid min-h-24 grid-cols-[40px_1fr] gap-3 py-4 ${
                    index % 2 === 0
                      ? "sm:pr-4"
                      : "border-t border-[var(--line)] sm:border-l sm:border-t-0 sm:pl-4"
                  } ${index >= 2 ? "border-t border-[var(--line)]" : ""}`}
                  key={item.number}
                >
                  <span className="font-editorial text-xl text-[var(--accent)]">
                    {item.number}
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{item.title}</p>
                    <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <RecommendationDeck
            items={demos}
            loadingItemId={loadingDemoId}
            onOpenItem={onLoadDemo}
          />
        </div>
      </div>
    </section>
  );
}
