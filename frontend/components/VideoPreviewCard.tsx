"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import type { VideoInfo } from "@/lib/types";

export function VideoPreviewCard({ video }: { video: VideoInfo | null }) {
  const thumbnailUrl = getDisplayThumbnailUrl(video?.thumbnail ?? "");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--paper-deep)] text-[var(--muted)] sm:h-16 sm:w-16" data-testid="media-cover-frame">
      {thumbnailUrl && failedUrl !== thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt="内容封面"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => setFailedUrl(thumbnailUrl)}
        />
      ) : (
        <ImageIcon className="h-5 w-5" aria-label="封面暂不可用" />
      )}
    </div>
  );
}
