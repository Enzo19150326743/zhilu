import { ArrowUpRight, FileText, Loader2 } from "lucide-react";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import type { DemoItem } from "@/lib/types";

import { MediaUrlForm } from "./MediaUrlForm";
import styles from "./LandingHero.module.css";

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
      <div className="flex items-end justify-between gap-4 border-2 border-b-0 border-[var(--line-ink)] bg-[var(--ink)] px-4 py-3">
        <h2 className="font-editorial text-lg font-bold text-[var(--paper-raised)]">
          快速体验
        </h2>
      </div>

      <div className="divide-y divide-[var(--line-strong)] rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] shadow-hard-md">
        {items.slice(0, 3).map((item) => {
          const isLoading = loadingItemId === item.demo_id;
          const thumbnailUrl = getDisplayThumbnailUrl(item.thumbnail);

          return (
            <button
              className="group grid min-h-[88px] w-full grid-cols-[78px_minmax(0,1fr)_24px] items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isLoading}
              key={item.demo_id}
              type="button"
              onClick={() => onOpenItem(item.demo_id)}
            >
              <span className="aspect-video overflow-hidden rounded-[2px] bg-[var(--ink)]">
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
                <span className="font-editorial line-clamp-2 text-sm font-semibold leading-6 text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">
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
    <section className="border-b-2 border-[var(--line-ink)] bg-[var(--paper)]">
      <div className="mx-auto grid max-w-[90rem] gap-10 px-4 py-9 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] lg:items-start lg:gap-16 lg:px-10">
        <div className="min-w-0">
          <h1 className={styles.title}>
            <span className={styles.lead}>把公开内容提炼成</span>
            <span className={styles.highlight}>可编辑的知识稿</span>
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            粘贴公开链接，提取全文、生成总结，再整理成自己的知识稿。
          </p>

          <div className="mt-6">
            <MediaUrlForm
              isSubmitting={isSubmitting}
              value={url}
              size="large"
              onAnalyze={onAnalyze}
              onChange={onChangeUrl}
            />

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
