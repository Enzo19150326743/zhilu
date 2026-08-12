export function getPlatformLabel(platform: string): string {
  const normalizedPlatform = platform.toLowerCase();
  if (normalizedPlatform === "bilibili") {
    return "B 站";
  }
  if (normalizedPlatform === "xiaoyuzhou") {
    return "小宇宙";
  }
  if (normalizedPlatform === "xiaohongshu") {
    return "小红书";
  }
  if (normalizedPlatform === "douyin") {
    return "抖音";
  }
  if (normalizedPlatform === "demo") {
    return "推荐";
  }

  return platform || "未知来源";
}
