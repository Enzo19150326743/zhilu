from collections.abc import Callable
from typing import Any

from app.services.douyin_service import get_douyin_thumbnail_url, is_douyin_url


def is_temporary_signed_cover_url(url: str) -> bool:
    """识别不适合作为仓库长期资源的临时签名封面地址。"""
    normalized_url = url.strip().lower()
    return "x-expires=" in normalized_url or "x-signature=" in normalized_url


def resolve_demo_cover_url(
    demo: dict[str, Any],
    douyin_thumbnail_resolver: Callable[[str], str] = get_douyin_thumbnail_url,
) -> str:
    """返回当前可用的媒体源封面；临时抖音地址从公开来源页刷新。"""
    stored_thumbnail = str(demo.get("thumbnail") or "").strip()
    if stored_thumbnail and not is_temporary_signed_cover_url(stored_thumbnail):
        return stored_thumbnail

    video = demo.get("video")
    if not isinstance(video, dict):
        return ""

    platform = str(video.get("platform") or "").strip().lower()
    source_url = str(video.get("url") or "").strip()
    if source_url and (platform == "douyin" or is_douyin_url(source_url)):
        return douyin_thumbnail_resolver(source_url).strip()

    return ""
