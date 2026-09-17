"""公开媒体链接提取与稳定规范化。"""

import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import HTTPException

PUBLIC_URL_PATTERN = re.compile(r"https?://[^\s，。；;、]+")
BILIBILI_VIDEO_PATH_PATTERN = re.compile(r"^/video/(BV[a-zA-Z0-9]+)")
BILIBILI_ALLOWED_QUERY_KEYS = {"p", "t"}


def extract_public_urls(raw_text: str) -> list[str]:
    """从多行分享文案中提取全部 URL，并保留首次出现顺序。"""
    urls = [match.group(0).rstrip(").,，。；;、") for match in PUBLIC_URL_PATTERN.finditer(raw_text)]
    return list(dict.fromkeys(urls))


def extract_public_url(raw_text: str) -> str:
    stripped = raw_text.strip()
    urls = extract_public_urls(stripped)
    return urls[0] if urls else stripped


def normalize_bilibili_video_url(video_url: str) -> str:
    parsed = urlparse(video_url)
    hostname = parsed.hostname or ""
    if not (hostname.endswith("bilibili.com") or hostname.endswith("b23.tv")):
        return video_url
    match = BILIBILI_VIDEO_PATH_PATTERN.search(parsed.path)
    if not match:
        return video_url
    safe_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key in BILIBILI_ALLOWED_QUERY_KEYS and value
    ]
    return urlunparse((parsed.scheme, parsed.netloc, f"/video/{match.group(1)}", "", urlencode(safe_query), ""))


def normalize_public_video_url(raw_url: str) -> str:
    video_url = extract_public_url(raw_url)
    parsed = urlparse(video_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "INVALID_URL",
                "message": "请输入以 http:// 或 https:// 开头的公开媒体链接。",
            },
        )
    return normalize_bilibili_video_url(video_url)
