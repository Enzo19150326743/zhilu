import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from yt_dlp.utils import js_to_json

from app.schemas import ParseResponse
from app.services.http_fetch_service import fetch_public_text
from app.services.ytdlp_service import extract_video_metadata

logger = logging.getLogger(__name__)

XIAOHONGSHU_HOSTS = {"xiaohongshu.com", "www.xiaohongshu.com"}
XIAOHONGSHU_VIDEO_PATH_PATTERN = re.compile(
    r"^/(?:explore|discovery/item)/(?P<note_id>[\da-f]+)/*$",
    flags=re.IGNORECASE,
)
XIAOHONGSHU_INITIAL_STATE_VARIABLE = "window.__INITIAL_STATE__"
XIAOHONGSHU_PAGE_ACCEPT_HEADER = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
)
XIAOHONGSHU_PAGE_TIMEOUT_SECONDS = 15

MetadataParser = Callable[[str], ParseResponse]
PageFetcher = Callable[..., str]


@dataclass(frozen=True)
class XiaohongshuPageMetadata:
    """小红书公开页面对通用 yt-dlp 结果的最小补充。"""

    author: str | None = None
    thumbnail_url: str | None = None
    transcription_source_url: str | None = None


def is_xiaohongshu_url(source_url: str) -> bool:
    """判断 URL 是否为当前正式支持的小红书公开视频页面。"""
    parsed_url = urlparse(source_url)
    hostname = (parsed_url.hostname or "").lower()
    return (
        parsed_url.scheme in {"http", "https"}
        and hostname in XIAOHONGSHU_HOSTS
        and XIAOHONGSHU_VIDEO_PATH_PATTERN.fullmatch(parsed_url.path) is not None
    )


def parse_xiaohongshu_video(
    source_url: str,
    *,
    metadata_parser: MetadataParser = extract_video_metadata,
    page_fetcher: PageFetcher = fetch_public_text,
) -> ParseResponse:
    """
    复用 yt-dlp 的视频解析，并补齐公开作者、清晰封面和转写媒体源。

    页面补取失败时保留视频主流程返回，避免平台页面的短期变化阻断基础
    元数据解析；转写时会重新执行同一解析以刷新短期签名媒体地址。
    """
    response = metadata_parser(source_url)
    response.video.platform = "xiaohongshu"

    note_id = _extract_note_id(source_url)
    if note_id is None:
        return response

    try:
        page_html = page_fetcher(
            source_url,
            accept_header=XIAOHONGSHU_PAGE_ACCEPT_HEADER,
            timeout_seconds=XIAOHONGSHU_PAGE_TIMEOUT_SECONDS,
        )
        page_metadata = extract_xiaohongshu_page_metadata(page_html, note_id)
    except (OSError, TimeoutError, UnicodeError, ValueError):
        logger.warning(
            "xiaohongshu public metadata enrichment failed: note_id=%s",
            note_id,
        )
        return response

    if page_metadata.author and _is_missing_author(response.video.author):
        response.video.author = page_metadata.author
    if page_metadata.thumbnail_url:
        response.video.thumbnail = page_metadata.thumbnail_url
    if page_metadata.transcription_source_url:
        response.transcription_source_url = page_metadata.transcription_source_url
    return response


def extract_xiaohongshu_author(page_html: str, note_id: str) -> str | None:
    """从公开页面初始状态读取笔记作者昵称。"""
    return extract_xiaohongshu_page_metadata(page_html, note_id).author


def extract_xiaohongshu_page_metadata(
    page_html: str,
    note_id: str,
) -> XiaohongshuPageMetadata:
    """一次解析公开页面，避免作者、封面和转写源各自读取状态。"""
    initial_state = _read_assigned_object(
        page_html,
        XIAOHONGSHU_INITIAL_STATE_VARIABLE,
    )
    if not isinstance(initial_state, dict):
        return XiaohongshuPageMetadata()

    note = _nested_value(
        initial_state,
        "note",
        "noteDetailMap",
        note_id,
        "note",
    )
    if not isinstance(note, dict):
        return XiaohongshuPageMetadata()

    author = _nested_value(note, "user", "nickname")
    normalized_author = author.strip() if isinstance(author, str) else ""
    return XiaohongshuPageMetadata(
        author=normalized_author or None,
        thumbnail_url=_extract_clear_thumbnail_url(note),
        transcription_source_url=_extract_transcription_source_url(note),
    )


def _extract_clear_thumbnail_url(note: dict[str, Any]) -> str | None:
    """只使用默认清晰图，绝不以色块化 PRV 预览覆盖现有封面。"""
    image_list = note.get("imageList")
    if not isinstance(image_list, list):
        return None

    for image in image_list:
        if not isinstance(image, dict):
            continue
        direct_url = _normalize_http_url(image.get("urlDefault"))
        if direct_url:
            return direct_url

        info_list = image.get("infoList")
        if not isinstance(info_list, list):
            continue
        for image_info in info_list:
            if not isinstance(image_info, dict):
                continue
            if str(image_info.get("imageScene") or "").upper() != "WB_DFT":
                continue
            scene_url = _normalize_http_url(image_info.get("url"))
            if scene_url:
                return scene_url

    return None


def _extract_transcription_source_url(note: dict[str, Any]) -> str | None:
    """选择体积最小的兼容 H.264 音视频流，减少本地转写下载成本。"""
    video = note.get("video")
    if not isinstance(video, dict):
        return None

    stream_groups = _nested_value(video, "media", "stream")
    if not isinstance(stream_groups, dict):
        media_v2 = video.get("mediaV2")
        if isinstance(media_v2, str):
            try:
                media_payload = json.loads(media_v2)
            except json.JSONDecodeError:
                media_payload = None
            if isinstance(media_payload, dict):
                stream_groups = media_payload.get("stream")

    if not isinstance(stream_groups, dict):
        return None

    candidates: list[tuple[int, str]] = []
    for stream in stream_groups.get("h264") or []:
        if not isinstance(stream, dict):
            continue
        audio_codec = str(
            stream.get("audioCodec") or stream.get("audio_codec") or ""
        ).strip()
        stream_url = _normalize_http_url(
            stream.get("masterUrl") or stream.get("master_url")
        )
        if not audio_codec or audio_codec.lower() == "none" or not stream_url:
            continue
        raw_size = stream.get("size")
        size = raw_size if isinstance(raw_size, int) and raw_size > 0 else 2**63 - 1
        candidates.append((size, stream_url))

    return min(candidates, default=(0, ""), key=lambda item: item[0])[1] or None


def _normalize_http_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized_value = value.strip()
    parsed_url = urlparse(normalized_value)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        return None
    return normalized_value


def _extract_note_id(source_url: str) -> str | None:
    match = XIAOHONGSHU_VIDEO_PATH_PATTERN.fullmatch(urlparse(source_url).path)
    return match.group("note_id") if match else None


def _read_assigned_object(page_html: str, variable_name: str) -> object:
    assignment_match = re.search(
        rf"{re.escape(variable_name)}\s*=\s*",
        page_html,
    )
    if assignment_match is None:
        return None

    start_index = page_html.find("{", assignment_match.end())
    if start_index < 0:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start_index, len(page_html)):
        character = page_html[index]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue

        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(js_to_json(page_html[start_index : index + 1]))
                except (TypeError, json.JSONDecodeError):
                    return None

    return None


def _nested_value(value: object, *keys: str) -> Any:
    current_value = value
    for key in keys:
        if not isinstance(current_value, dict):
            return None
        current_value = current_value.get(key)
    return current_value


def _is_missing_author(author: str) -> bool:
    return author.strip().lower() in {"", "unknown", "未知", "未知作者"}
