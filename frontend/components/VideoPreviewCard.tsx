"use client";

import { useEffect, useState } from "react";
import { Clock3, MonitorPlay, Radio, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import { isPodcastMedia } from "@/lib/media";
import { getPlatformLabel } from "@/lib/platform-display";
import type { VideoInfo } from "@/lib/types";

interface VideoPreviewCardProps {
  video: VideoInfo | null;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getCoverFrameClass(video: VideoInfo): string {
  return isPodcastMedia(video)
    ? "shadow-hard-md relative aspect-square overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--ink)]"
    : "shadow-hard-md relative aspect-[4/3] overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-deep)]";
}

function getCoverImageClass(video: VideoInfo): string {
  return isPodcastMedia(video)
    ? "relative z-10 h-full w-full object-contain p-3"
    : "relative z-10 h-full w-full object-contain";
}

function getCoverFallbackClass(video: VideoInfo): string {
  return isPodcastMedia(video)
    ? "flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--paper-deep)] px-4 text-center text-sm text-[var(--muted)]"
    : "flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--paper-deep)] px-4 text-center text-sm text-[var(--muted)]";
}

function getInfoRows(video: VideoInfo): Array<{
  icon: LucideIcon;
  label: string;
  value: string;
}> {
  const isPodcast = isPodcastMedia(video);
  const normalizedPlatform = video.platform.toLowerCase();

  return [
    {
      icon: UserRound,
      label: isPodcast
        ? "主播"
        : normalizedPlatform === "bilibili"
          ? "UP主"
          : "作者",
      value: video.author || "未知"
    },
    {
      icon: Clock3,
      label: isPodcast ? "节目时长" : "视频时长",
      value: formatDuration(video.duration)
    },
    {
      icon: isPodcast ? Radio : MonitorPlay,
      label: isPodcast ? "播客来源" : "平台",
      value: getPlatformLabel(video.platform)
    },
    {
      icon: MonitorPlay,
      label: "内容类型",
      value: isPodcast ? "播客单集" : "视频"
    }
  ];
}

export function VideoPreviewCard({ video }: VideoPreviewCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [video?.thumbnail, video?.video_id]);

  if (!video) {
    return (
      <section className="min-w-0 rounded-[2px] border-2 border-dashed border-[var(--line-strong)] bg-[var(--paper-raised)] p-5">
        <div className="flex aspect-video items-center justify-center rounded-[2px] bg-[var(--paper-deep)] text-sm text-[var(--muted)]">
          粘贴链接或打开推荐内容后，这里会显示媒体预览。
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-4 w-3/4 bg-[var(--paper-deep)]" />
          <div className="h-3 w-1/2 bg-[var(--paper-deep)]" />
        </div>
      </section>
    );
  }

  const thumbnailUrl = getDisplayThumbnailUrl(video.thumbnail);
  const infoRows = getInfoRows(video);

  return (
    <section className="mx-auto w-full min-w-0 max-w-[420px] lg:mx-0 lg:max-w-none">
      <div className={getCoverFrameClass(video)} data-testid="media-cover-frame">
        {thumbnailUrl && !imageFailed ? (
          <>
            <img
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-xl"
              referrerPolicy="no-referrer"
              src={thumbnailUrl}
            />
            <img
              alt={`${video.title} 封面`}
              className={getCoverImageClass(video)}
              referrerPolicy="no-referrer"
              src={thumbnailUrl}
              onError={() => setImageFailed(true)}
            />
          </>
        ) : (
          <div className={getCoverFallbackClass(video)}>
            <MonitorPlay className="h-8 w-8 text-[var(--muted)]" aria-hidden="true" />
            <span>封面暂不可用</span>
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="font-editorial text-[17px] font-semibold leading-6 text-[var(--ink)]">
          {video.title}
        </p>
        <div className="mt-4 grid gap-2.5 border-t-2 border-[var(--line-ink)] pt-4">
          {infoRows.map((row) => {
            const Icon = row.icon;

            return (
              <div
                className="grid grid-cols-[16px_64px_1fr] items-center gap-2"
                key={row.label}
              >
                <Icon className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
                <span className="text-[10px] font-medium text-[var(--muted)]">
                  {row.label}
                </span>
                <span
                  className="min-w-0 truncate text-xs text-[var(--ink-soft)]"
                  title={row.value}
                >
                  {row.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
