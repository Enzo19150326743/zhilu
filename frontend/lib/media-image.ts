const DEFAULT_BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "http://127.0.0.1:8000";

/**
 * 远程媒体封面统一经过后端代理，本地原创兜底图则直接由 Next.js 提供。
 */
export function getDisplayThumbnailUrl(
  thumbnail: string,
  backendBaseUrl = DEFAULT_BACKEND_BASE_URL
): string {
  const trimmedThumbnail = thumbnail.trim();
  if (!trimmedThumbnail) {
    return "";
  }

  const normalizedBackendBaseUrl = backendBaseUrl.replace(/\/+$/, "");
  if (trimmedThumbnail.startsWith("/api/")) {
    return `${normalizedBackendBaseUrl}${trimmedThumbnail}`;
  }

  if (
    trimmedThumbnail.startsWith("http://") ||
    trimmedThumbnail.startsWith("https://")
  ) {
    return `${normalizedBackendBaseUrl}/api/image-proxy?url=${encodeURIComponent(trimmedThumbnail)}`;
  }

  return trimmedThumbnail;
}
