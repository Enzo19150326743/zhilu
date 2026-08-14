import { ArrowUpRight, FileText, Link2, Loader2, Search } from "lucide-react";
import SplitText from "@/components/SplitText";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import type { DemoItem } from "@/lib/types";

interface LandingHeroProps {
  demos: DemoItem[];
  errorMessage: string | null;
  isParsing: boolean;
  loadingDemoId: string | null;
  url: string;
  onAnalyze: () => void;
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

      <div className="shadow-hard-md divide-y-2 divide-[var(--line-ink)] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)]">
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
              <span className="aspect-video overflow-hidden border-2 border-[var(--line-ink)] bg-[var(--ink)]">
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
  isParsing,
  loadingDemoId,
  url,
  onAnalyze,
  onChangeUrl,
  onLoadDemo
}: LandingHeroProps) {
  return (
    <section className="border-b-2 border-[var(--line-ink)] bg-[var(--paper)]">
      <div className="mx-auto grid max-w-[90rem] gap-9 px-4 pb-10 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.75fr)] lg:items-start lg:gap-12 lg:px-10 lg:pb-11 lg:pt-9">
        <div className="min-w-0">
          <h1 className="font-display text-balance text-[clamp(2.7rem,5.3vw,4.8rem)] leading-[1.07] text-[var(--ink)]">
            <span className="block">
              <SplitText
                tag="span"
                text="看见的，"
                className="mr-[0.16em]"
                delay={45}
                duration={1.10}
                ease="power3.out"
                splitType="words"
                from={{ opacity: 0, y: 48 }}
                to={{ opacity: 1, y: 0 }}
                rootMargin="0px"
		startDelay={0.10}
                textAlign="left"
              />
              <SplitText
                tag="span"
                text="听见的，"
                delay={45}
                duration={1.00}
                ease="power3.out"
                splitType="words"
                from={{ opacity: 0, y: 48 }}
                to={{ opacity: 1, y: 0 }}
                rootMargin="0px"
                startDelay={0.32}
                textAlign="left"
              />
            </span>
            <span className="mt-2 block">
              <span className="shadow-hard-md inline-block border-2 border-[var(--line-ink)] bg-[var(--accent)] px-2 pb-1 text-[var(--paper-raised)]">
                <SplitText
                  tag="span"
                  text="都变成你的知识。"
                  delay={45}
                  duration={1.10}
                  ease="power3.out"
                  splitType="words"
                  from={{ opacity: 0, y: 48 }}
                  to={{ opacity: 1, y: 0 }}
                  rootMargin="0px"
                  startDelay={0.56}
                  textAlign="left"
                />
              </span>
            </span>
          </h1>

          <div className="editorial-enter editorial-enter-delay-1 mt-5 max-w-[760px]">
            <div className="shadow-hard-md flex min-h-[54px] min-w-0 items-stretch border-2 border-[var(--line-ink)] bg-[var(--paper-raised)]">
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
                className="inline-flex min-h-[54px] shrink-0 items-center justify-center gap-2 border-l-2 border-[var(--line-ink)] bg-[var(--accent)] px-5 text-sm font-bold text-[var(--paper-raised)] transition-colors hover:bg-[var(--accent-deep)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--paper-deep)] disabled:text-[var(--muted)]"
                disabled={isParsing || !url.trim()}
                type="button"
                onClick={onAnalyze}
              >
                {isParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden="true" />
                )}
                {isParsing ? "提取中" : "提取内容"}
              </button>
            </div>

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
