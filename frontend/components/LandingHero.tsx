import { ArrowUpRight, FileText, Link2, Loader2, Search } from "lucide-react";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import type { DemoItem } from "@/lib/types";

interface LandingHeroProps {
  demos: DemoItem[];
  errorMessage: string | null;
  isSubmitting: boolean;
  loadingDemoId: string | null;
  url: string;
  onAnalyze: () => void;
  onBatchAdd: () => void;
  onChangeUrl: (value: string) => void;
  onLoadDemo: (demoId: string) => void;
}

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
    <aside className="editorial-enter editorial-enter-delay-2 min-w-0 lg:pt-2">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="font-editorial text-xl font-bold text-[var(--ink)]">
          快速体验
        </h2>
      </div>

      <div className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_10px_28px_rgba(54,45,32,0.06)]">
        {items.slice(0, 3).map((item) => {
          const isLoading = loadingItemId === item.demo_id;
          const thumbnailUrl = getDisplayThumbnailUrl(item.thumbnail);

          return (
            <button
              className="group grid min-h-[82px] w-full grid-cols-[78px_minmax(0,1fr)_24px] items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isLoading}
              key={item.demo_id}
              type="button"
              onClick={() => onOpenItem(item.demo_id)}
            >
              <span className="aspect-video overflow-hidden rounded-md bg-[var(--ink)]">
                {thumbnailUrl ? (
                  <img
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    src={thumbnailUrl}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[var(--paper-raised)]">
                    <FileText aria-hidden="true" className="h-5 w-5" />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="font-editorial line-clamp-1 text-sm font-semibold leading-6 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
                  {item.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                  {item.description}
                </span>
              </span>
              {isLoading ? (
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin text-[var(--accent)]"
                />
              ) : (
                <ArrowUpRight
                  aria-hidden="true"
                  className="h-4 w-4 text-[var(--muted)] transition-[color,transform] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function LandingHero({
  demos,
  errorMessage,
  isSubmitting,
  loadingDemoId,
  url,
  onAnalyze,
  onBatchAdd,
  onChangeUrl,
  onLoadDemo
}: LandingHeroProps) {
  return (
    <section className="border-b border-[var(--line)] bg-[var(--paper)]">
      <div className="mx-auto grid max-w-[82rem] gap-8 px-4 pb-8 pt-7 sm:px-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-start lg:gap-10 lg:px-10 lg:pb-9 lg:pt-8">
        <div className="min-w-0">
          <h1 className="text-balance text-[clamp(2.25rem,4.2vw,3.9rem)] font-bold leading-[1.12] tracking-[-0.04em] text-[var(--ink)]">
            把公开内容提炼成
            <span className="text-[var(--accent)]">可编辑的知识稿</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            一次提交会按需提取全文、本地转写并生成总结；AI 未配置时会明确显示可用的基础结果。
          </p>

          <div className="mt-5 max-w-[760px]">
            <div className="flex min-h-[54px] min-w-0 items-stretch overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] shadow-[0_10px_28px_rgba(54,45,32,0.07)] focus-within:border-[var(--accent)]">
              <div className="relative min-w-0 flex-1">
                <Link2
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--muted)]"
                />
                <input
                  aria-label="公开媒体链接"
                  className="min-h-[54px] w-full border-0 bg-transparent pl-11 pr-3 text-base text-[var(--ink)] outline-none placeholder:text-[#9b927f] focus-visible:outline-none disabled:cursor-not-allowed"
                  inputMode="url"
                  placeholder="粘贴 B 站、小红书、小宇宙或抖音公开链接"
                  type="text"
                  value={url}
                  onChange={(event) => onChangeUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onAnalyze();
                    }
                  }}
                />
              </div>
              <button
                className="inline-flex min-h-[54px] shrink-0 cursor-pointer items-center justify-center gap-2 border-l border-[var(--line)] bg-[var(--accent)] px-5 text-sm font-bold text-[var(--paper-raised)] transition-colors hover:bg-[var(--accent-deep)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)] disabled:text-[var(--muted)]"
                disabled={isSubmitting || !url.trim()}
                type="button"
                onClick={onAnalyze}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden="true" />
                )}
                {isSubmitting ? "提交中" : "提炼内容"}
              </button>
            </div>

            <button
              className="mt-3 text-sm font-semibold text-[var(--muted)] underline decoration-2 underline-offset-4 hover:text-[var(--accent)]"
              type="button"
              onClick={onBatchAdd}
            >
              处理设置或批量添加
            </button>

            {errorMessage ? (
              <div className="shadow-hard-sm mt-4 border-2 border-[var(--line-ink)] bg-[var(--accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--ink)]">
                {errorMessage}
              </div>
            ) : null}

          </div>
        </div>

        <RecommendationDeck
          items={demos}
          loadingItemId={loadingDemoId}
          onOpenItem={onLoadDemo}
        />
      </div>
    </section>
  );
}
