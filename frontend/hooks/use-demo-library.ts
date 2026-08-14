"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import { getDisplayThumbnailUrl } from "@/lib/media-image";
import type { DemoItem } from "@/lib/types";

const DEMO_COVER_PRELOAD_TIMEOUT_MS = 5000;

function preloadDemoCover(thumbnail: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    let hasSettled = false;
    const settle = () => {
      if (hasSettled) {
        return;
      }
      hasSettled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(settle, DEMO_COVER_PRELOAD_TIMEOUT_MS);

    image.onload = settle;
    image.onerror = settle;
    image.src = getDisplayThumbnailUrl(thumbnail);
  });
}

export function useDemoLibrary() {
  const [demos, setDemos] = useState<DemoItem[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      let nextDemos: DemoItem[] = [];
      try {
        const response = await apiClient.getDemos();
        nextDemos = response.demos;
      } catch {}

      await Promise.all(
        nextDemos.slice(0, 3).map((demo) => preloadDemoCover(demo.thumbnail))
      );
      if (isCancelled) {
        return;
      }

      setDemos(nextDemos);
      setIsReady(true);
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  return { demos, isReady };
}
