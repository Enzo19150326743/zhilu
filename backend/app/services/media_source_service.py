import logging
from typing import Protocol
from urllib.parse import urlparse

from fastapi import HTTPException

from app.schemas import ParseResponse
from app.services.bilibili_service import is_bilibili_url, parse_bilibili_video
from app.services.douyin_service import is_douyin_url, parse_douyin_video
from app.services.xiaoyuzhou_service import (
    is_xiaoyuzhou_url,
    parse_xiaoyuzhou_episode,
)
from app.services.xiaohongshu_service import (
    is_xiaohongshu_url,
    parse_xiaohongshu_video,
)
from app.services.ytdlp_service import extract_video_metadata

logger = logging.getLogger(__name__)


class MediaSourceAdapter(Protocol):
    """媒体输入源解析适配器。"""

    source_name: str

    def can_handle(self, source_url: str) -> bool:
        """
        判断当前适配器是否支持该输入源。
        """

    def parse(self, source_url: str) -> ParseResponse:
        """
        解析输入源并返回统一工作台数据。
        """


class YtdlpVideoSourceAdapter:
    """默认视频输入源适配器。"""

    source_name = "ytdlp_video"

    def can_handle(self, source_url: str) -> bool:
        """
        让 yt-dlp 继续作为通用公开视频解析兜底。
        """
        parsed_url = urlparse(source_url)
        return parsed_url.scheme in {"http", "https"} and bool(parsed_url.netloc)

    def parse(self, source_url: str) -> ParseResponse:
        """
        调用现有 yt-dlp 视频解析链路。
        """
        return extract_video_metadata(source_url)


class XiaoyuzhouEpisodeSourceAdapter:
    """小宇宙公开单集输入源适配器。"""

    source_name = "xiaoyuzhou_episode"

    def can_handle(self, source_url: str) -> bool:
        """
        小宇宙链接由专用适配器处理，不落到 yt-dlp 通用兜底。
        """
        return is_xiaoyuzhou_url(source_url)

    def parse(self, source_url: str) -> ParseResponse:
        """
        解析小宇宙公开单集元数据与 shownotes。
        """
        return parse_xiaoyuzhou_episode(source_url)


class DouyinVideoSourceAdapter:
    """抖音公开短视频输入源适配器。"""

    source_name = "douyin_video"

    def can_handle(self, source_url: str) -> bool:
        """
        抖音走专用解析，避免落到 yt-dlp 通用兜底。
        """
        return is_douyin_url(source_url)

    def parse(self, source_url: str) -> ParseResponse:
        """
        解析抖音公开视频元数据与下载直链。
        """
        return parse_douyin_video(source_url)


class BilibiliVideoSourceAdapter:
    """B 站公开视频输入源适配器。"""

    source_name = "bilibili_video"

    def can_handle(self, source_url: str) -> bool:
        """
        B 站先走专用取流链路，避免通用 yt-dlp 播放流接口 412 阻断转写。
        """
        return is_bilibili_url(source_url)

    def parse(self, source_url: str) -> ParseResponse:
        """
        解析 B 站公开视频元数据与 DASH audio 转写源。
        """
        try:
            return parse_bilibili_video(source_url)
        except HTTPException as error:
            if not _should_fallback_to_ytdlp(error):
                raise

            logger.warning(
                "bilibili adapter failed, falling back to yt-dlp: %s",
                _get_error_code(error),
            )
            return extract_video_metadata(source_url)


class XiaohongshuVideoSourceAdapter:
    """小红书公开视频输入源适配器。"""

    source_name = "xiaohongshu_video"

    def can_handle(self, source_url: str) -> bool:
        """只接管当前正式支持的小红书公开视频页面。"""
        return is_xiaohongshu_url(source_url)

    def parse(self, source_url: str) -> ParseResponse:
        """复用 yt-dlp 视频能力并补齐公开作者昵称。"""
        return parse_xiaohongshu_video(source_url)


MEDIA_SOURCE_ADAPTERS: list[MediaSourceAdapter] = [
    DouyinVideoSourceAdapter(),
    XiaoyuzhouEpisodeSourceAdapter(),
    BilibiliVideoSourceAdapter(),
    XiaohongshuVideoSourceAdapter(),
    YtdlpVideoSourceAdapter(),
]


def parse_media_source(source_url: str) -> ParseResponse:
    """
    按顺序分派媒体输入源，保持 /api/parse 对前端的返回结构不变。

    NOTE: 后续接入小宇宙时，只新增更靠前的专用 Adapter，不在 main.py 里堆平台判断。
    """
    for adapter in MEDIA_SOURCE_ADAPTERS:
        if adapter.can_handle(source_url):
            return adapter.parse(source_url)

    raise HTTPException(
        status_code=400,
        detail={
            "success": False,
            "error_code": "UNSUPPORTED_SOURCE",
            "message": "当前版本暂不支持该输入源。",
        },
    )


def _should_fallback_to_ytdlp(error: HTTPException) -> bool:
    """
    B 站专用链路仍处第一阶段；接口波动时保留现有 yt-dlp 公开元数据兜底。
    """
    return _get_error_code(error) != "BILIBILI_ACCESS_RESTRICTED"


def _get_error_code(error: HTTPException) -> str:
    detail = error.detail
    if isinstance(detail, dict):
        return str(detail.get("error_code") or "")

    return ""
