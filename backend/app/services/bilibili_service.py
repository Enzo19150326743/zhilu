import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, parse_qsl, urlencode, urlparse
from urllib.request import Request, urlopen

from fastapi import HTTPException

from app.schemas import (
    BilibiliAuthStatusResponse,
    DownloadResponse,
    FormatDiagnostics,
    ParseResponse,
)
from app.services.http_fetch_service import DEFAULT_USER_AGENT
from app.services.ytdlp_service import PLACEHOLDER_THUMBNAIL

logger = logging.getLogger(__name__)

BILIBILI_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8"
BILIBILI_JSON_ACCEPT_HEADER = "application/json,text/plain,*/*"
BILIBILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view"
BILIBILI_NAV_API = "https://api.bilibili.com/x/web-interface/nav"
BILIBILI_BUVID_API = "https://api.bilibili.com/x/frontend/finger/spi"
BILIBILI_PLAYURL_API = "https://api.bilibili.com/x/player/wbi/playurl"
BILIBILI_TIMEOUT_SECONDS = 15
BILIBILI_WBI_CACHE_SECONDS = 30
BILIBILI_COOKIE_FILE_ENV = "BILIBILI_COOKIE_FILE"
BILIBILI_ENABLE_COOKIE_OPTIONS_ENV = "BILIBILI_ENABLE_COOKIE_OPTIONS"
BILIBILI_BVID_PATTERN = r"BV[a-zA-Z0-9]{10}"
BILIBILI_AUDIO_FORMAT_ID = "bilibili_dash_audio"
BILIBILI_VIDEO_FORMAT_PREFIX = "bilibili_video_"
BILIBILI_AUDIO_FORMAT_PREFIX = "bilibili_audio_"
BILIBILI_PLATFORM_REJECTED_STATUS_CODES = {403, 412, 429}
BILIBILI_ACCESS_RESTRICTED_CODES = {-403, -10403}
BILIBILI_COOKIE_DOMAIN_MARKER = "bilibili.com"
BILIBILI_DOWNLOAD_CHUNK_SIZE = 1024 * 1024
BILIBILI_FFMPEG_TIMEOUT_SECONDS = 60 * 60
BILIBILI_MAX_FORMATS = 16
BILIBILI_MAX_AUDIO_FORMATS = 3
DOWNLOAD_TEMP_SUFFIXES = {".part", ".tmp", ".temp"}
SUPPORTED_MERGE_OUTPUT_FORMATS = {"mp4", "mkv", "webm"}
BILIBILI_MIXIN_KEY_ENC_TAB = [
    46,
    47,
    18,
    2,
    53,
    8,
    23,
    32,
    15,
    50,
    10,
    31,
    58,
    3,
    45,
    35,
    27,
    43,
    5,
    49,
    33,
    9,
    42,
    19,
    29,
    28,
    14,
    39,
    12,
    38,
    41,
    13,
    37,
    48,
    7,
    16,
    24,
    55,
    40,
    61,
    26,
    17,
    0,
    1,
    60,
    51,
    30,
    4,
    22,
    25,
    54,
    21,
    56,
    59,
    6,
    63,
    57,
    62,
    11,
    36,
    20,
    34,
    44,
    52,
]
WBI_FILTER_CHARS = frozenset("!'()*")
_wbi_key_cache: dict[str, Any] = {}


@dataclass(frozen=True)
class BilibiliSessionCookies:
    buvid3: str
    buvid4: str


@dataclass(frozen=True)
class BilibiliAudioStream:
    format_id: str
    url: str
    urls: tuple[str, ...]
    extension: str
    codec: str
    bandwidth: int
    filesize: int | None


@dataclass(frozen=True)
class BilibiliVideoStream:
    format_id: str
    url: str
    urls: tuple[str, ...]
    extension: str
    codec: str
    quality: int
    width: int
    height: int
    bandwidth: int
    filesize: int | None
    description: str


@dataclass(frozen=True)
class BilibiliVideo:
    bvid: str
    aid: int
    cid: int
    source_url: str
    title: str
    author: str
    duration: int
    thumbnail: str
    audio: BilibiliAudioStream
    audio_streams: list[BilibiliAudioStream]
    video_streams: list[BilibiliVideoStream]
    cookie_header: str


@dataclass(frozen=True)
class BilibiliTranscriptionSource:
    audio_url: str
    http_headers: dict[str, str]


@dataclass(frozen=True)
class BilibiliCookieBundle:
    cookies: dict[str, str]
    source: str | None
    file_configured: bool


def is_bilibili_url(source_url: str) -> bool:
    """
    判断是否为 B 站视频相关链接。
    """
    hostname = (urlparse(source_url).hostname or "").lower()
    return hostname.endswith("bilibili.com") or hostname.endswith("b23.tv")


def get_bilibili_auth_status() -> BilibiliAuthStatusResponse:
    """
    诊断显式本地 Cookie 是否可被 B 站 nav 接口识别为登录态。
    """
    cookie_options_enabled = _is_cookie_options_enabled()
    cookie_path = _get_configured_cookie_file_path()
    cookie_file_configured = cookie_path is not None
    cookie_bundle = _load_explicit_bilibili_cookie_bundle()
    cookie_header = _format_cookie_header(cookie_bundle.cookies)

    if not cookie_options_enabled:
        return BilibiliAuthStatusResponse(
            cookie_options_enabled=False,
            cookie_file_configured=cookie_file_configured,
            cookie_loaded=False,
            cookie_source=None,
            message="B 站显式 Cookie 能力未启用。",
        )

    if not cookie_bundle.cookies:
        return BilibiliAuthStatusResponse(
            cookie_options_enabled=True,
            cookie_file_configured=cookie_file_configured,
            cookie_loaded=False,
            cookie_source=cookie_bundle.source,
            message="B 站 Cookie 未加载，请检查本地 Cookie 文件配置。",
        )

    try:
        payload = _fetch_bilibili_api_json(
            BILIBILI_NAV_API,
            referer="https://www.bilibili.com",
            cookie_header=cookie_header,
            allow_non_zero_code_with_data=True,
        )
    except HTTPException:
        return BilibiliAuthStatusResponse(
            cookie_options_enabled=True,
            cookie_file_configured=cookie_file_configured,
            cookie_loaded=True,
            cookie_source=cookie_bundle.source,
            message="B 站 Cookie 已加载，但 nav 登录态校验失败。",
        )

    data = _as_dict(payload.get("data"))
    is_login = bool(data.get("isLogin"))
    username = _as_text(data.get("uname")) or None
    mid = _optional_positive_int(data.get("mid"))
    vip_payload = _as_dict(data.get("vip"))
    is_vip = bool(_safe_int(vip_payload.get("status") or data.get("vipStatus")))
    return BilibiliAuthStatusResponse(
        cookie_options_enabled=True,
        cookie_file_configured=cookie_file_configured,
        cookie_loaded=True,
        cookie_source=cookie_bundle.source,
        is_login=is_login,
        mid=mid,
        username=username,
        is_vip=is_vip,
        message="B 站 Cookie 已识别为登录态。"
        if is_login
        else "B 站 Cookie 已加载，但 nav 未识别为登录态。",
    )


def parse_bilibili_video(source_url: str) -> ParseResponse:
    """
    解析 B 站公开视频元数据，并取出可供 Whisper 使用的 DASH audio URL。
    """
    video = _extract_bilibili_video(source_url)
    return ParseResponse(
        source_url=source_url,
        is_placeholder=False,
        video={
            "video_id": video.bvid,
            "platform": "bilibili",
            "url": video.source_url,
            "title": video.title,
            "author": video.author,
            "duration": video.duration,
            "thumbnail": video.thumbnail,
            "has_transcript": False,
            "media_type": "video",
            "text_source_type": "content",
        },
        formats=_build_format_items(video),
        format_diagnostics=FormatDiagnostics(
            raw_format_count=len(video.video_streams) + len(video.audio_streams),
            max_height=_get_max_video_height(video.video_streams),
            has_cookie_config=_has_explicit_cookie_config(),
            is_bilibili=True,
        ),
        transcript={"segments": [], "plain_text": ""},
        summary=_build_summary_placeholder(video),
        mindmap_markdown="# B 站解析\n## 已完成\n### 标题\n### 作者\n### DASH 音频流\n## 下一步\n### AI 转写稿",
        transcription_source_url=video.audio.url,
    )


def resolve_bilibili_transcription_source(
    source_url: str,
) -> BilibiliTranscriptionSource:
    """
    为 /api/transcribe 解析新鲜的 B 站 DASH audio URL 和下载请求头。
    """
    video = _extract_bilibili_video(source_url)
    return BilibiliTranscriptionSource(
        audio_url=video.audio.url,
        http_headers=_build_audio_request_headers(
            video.source_url,
            cookie_header=video.cookie_header,
        ),
    )


def download_bilibili_video_format(
    source_url: str,
    format_id: str,
    merge_with_audio: bool,
) -> DownloadResponse:
    """
    下载 B 站专用 DASH 格式；video-only 格式可按现有接口参数合并最佳音频。
    """
    video = _extract_bilibili_video(source_url)
    clean_format_id = format_id.strip()
    if clean_format_id == "best":
        return _download_best_bilibili_format(video)

    if clean_format_id.startswith(BILIBILI_VIDEO_FORMAT_PREFIX):
        stream = _find_video_stream(video, clean_format_id)
        if merge_with_audio:
            return _download_and_merge_bilibili_streams(video, stream, video.audio)

        return _download_single_bilibili_stream(
            video=video,
            urls=stream.urls,
            extension=stream.extension,
            format_selector=stream.format_id,
            message="B 站仅视频流已保存到本地目录。",
        )

    if (
        clean_format_id.startswith(BILIBILI_AUDIO_FORMAT_PREFIX)
        or clean_format_id == BILIBILI_AUDIO_FORMAT_ID
    ):
        stream = (
            video.audio
            if clean_format_id == BILIBILI_AUDIO_FORMAT_ID
            else _find_audio_stream(video, clean_format_id)
        )
        return _download_single_bilibili_stream(
            video=video,
            urls=stream.urls,
            extension=stream.extension,
            format_selector=stream.format_id,
            message="B 站音频流已保存到本地目录。",
        )

    raise _build_bilibili_download_error(
        "INVALID_FORMAT_ID",
        "下载格式标识不正确，请重新解析后再选择格式。",
    )


def _extract_bilibili_video(source_url: str) -> BilibiliVideo:
    resolved_url = _resolve_bilibili_source_url(source_url)
    bvid = _extract_bvid(resolved_url)
    if not bvid:
        raise _build_bilibili_error(
            "BILIBILI_BVID_NOT_FOUND",
            "未能识别 B 站视频 BVID，请确认链接来自公开视频页。",
        )

    referer = f"https://www.bilibili.com/video/{bvid}"
    explicit_cookies = _load_explicit_bilibili_cookies()
    explicit_cookie_header = _format_cookie_header(explicit_cookies)
    view_data = _fetch_view_data(
        bvid,
        referer,
        cookie_header=explicit_cookie_header,
    )
    page = _select_video_page(view_data, resolved_url)
    cid = _safe_int(page.get("cid")) or _safe_int(view_data.get("cid"))
    if cid <= 0:
        raise _build_bilibili_error(
            "BILIBILI_CID_NOT_FOUND",
            "未能识别 B 站视频 CID，请换一个公开视频链接重试。",
        )

    try:
        session_cookies = _fetch_buvid_cookies(
            referer,
            cookie_header=explicit_cookie_header,
        )
    except HTTPException:
        if not explicit_cookies:
            raise

        logger.warning("bilibili buvid api failed, using explicit cookies only")
        session_cookies = BilibiliSessionCookies(buvid3="", buvid4="")

    cookie_header = _build_cookie_header(
        session_cookies,
        explicit_cookies=explicit_cookies,
    )
    play_data = _fetch_playurl_data(
        bvid=bvid,
        cid=cid,
        referer=referer,
        cookie_header=cookie_header,
    )
    audio_streams = _extract_audio_streams(play_data)
    if not audio_streams:
        raise _build_bilibili_error(
            "BILIBILI_AUDIO_NOT_FOUND",
            "B 站播放流接口未返回可用 DASH 音频。",
        )

    video_streams = _extract_video_streams(play_data)
    audio = _select_best_audio_stream(audio_streams)

    owner = _as_dict(view_data.get("owner"))
    return BilibiliVideo(
        bvid=bvid,
        aid=_safe_int(view_data.get("aid")),
        cid=cid,
        source_url=referer,
        title=_as_text(view_data.get("title")) or "未命名 B 站视频",
        author=_as_text(owner.get("name")) or "未知作者",
        duration=_safe_int(view_data.get("duration"))
        or _safe_int(page.get("duration")),
        thumbnail=_normalize_thumbnail_url(_as_text(view_data.get("pic"))),
        audio=audio,
        audio_streams=audio_streams,
        video_streams=video_streams,
        cookie_header=cookie_header,
    )


def _resolve_bilibili_source_url(source_url: str) -> str:
    if _extract_bvid(source_url):
        return source_url

    hostname = (urlparse(source_url).hostname or "").lower()
    if not hostname.endswith("b23.tv"):
        return source_url

    request = Request(
        source_url,
        headers=_build_api_request_headers("https://www.bilibili.com/"),
    )
    try:
        with urlopen(request, timeout=BILIBILI_TIMEOUT_SECONDS) as response:
            return response.geturl()
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        logger.warning("bilibili short link resolve failed: %s", error.__class__.__name__)
        return source_url


def _fetch_view_data(
    bvid: str,
    referer: str,
    *,
    cookie_header: str,
) -> dict[str, Any]:
    payload = _fetch_bilibili_api_json(
        f"{BILIBILI_VIEW_API}?{urlencode({'bvid': bvid})}",
        referer=referer,
        cookie_header=cookie_header,
    )
    data = _as_dict(payload.get("data"))
    if not data:
        raise _build_bilibili_error(
            "BILIBILI_METADATA_NOT_FOUND",
            "B 站公开元数据接口未返回可用视频信息。",
        )

    return data


def _fetch_buvid_cookies(
    referer: str,
    *,
    cookie_header: str,
) -> BilibiliSessionCookies:
    try:
        payload = _fetch_bilibili_api_json(
            BILIBILI_BUVID_API,
            referer=referer,
            cookie_header=cookie_header,
        )
    except HTTPException as error:
        raise _build_bilibili_error(
            "BILIBILI_BUVID_FAILED",
            "B 站 buvid 获取失败，暂时无法请求播放流接口。",
        ) from error

    data = _as_dict(payload.get("data"))
    buvid3 = _as_text(data.get("b_3"))
    buvid4 = _as_text(data.get("b_4"))
    if not buvid3 and not buvid4:
        raise _build_bilibili_error(
            "BILIBILI_BUVID_FAILED",
            "B 站 buvid 获取失败，暂时无法请求播放流接口。",
        )

    return BilibiliSessionCookies(buvid3=buvid3, buvid4=buvid4)


def _fetch_playurl_data(
    *,
    bvid: str,
    cid: int,
    referer: str,
    cookie_header: str,
) -> dict[str, Any]:
    params = _sign_wbi_params(
        {
            "from_client": "BROWSER",
            "fourk": 1,
            "fnver": 0,
            "fnval": 4048,
            "cid": cid,
            "qn": 125,
            "bvid": bvid,
        },
        bvid=bvid,
        referer=referer,
        cookie_header=cookie_header,
    )
    payload = _fetch_bilibili_api_json(
        f"{BILIBILI_PLAYURL_API}?{urlencode(params)}",
        referer=referer,
        cookie_header=cookie_header,
    )
    data = _as_dict(payload.get("data"))
    if not data:
        raise _build_bilibili_error(
            "BILIBILI_PLAYURL_EMPTY",
            "B 站播放流接口未返回可用数据。",
        )

    return data


def _sign_wbi_params(
    params: dict[str, Any],
    *,
    bvid: str,
    referer: str,
    cookie_header: str,
) -> dict[str, str]:
    signed_params = dict(params)
    signed_params["wts"] = int(time.time())
    normalized_params = {
        key: "".join(
            character
            for character in str(value)
            if character not in WBI_FILTER_CHARS
        )
        for key, value in sorted(signed_params.items())
    }
    query = urlencode(normalized_params)
    mixin_key = _get_wbi_mixin_key(
        bvid=bvid,
        referer=referer,
        cookie_header=cookie_header,
    )
    normalized_params["w_rid"] = hashlib.md5(
        f"{query}{mixin_key}".encode("utf-8")
    ).hexdigest()
    return normalized_params


def _get_wbi_mixin_key(
    *,
    bvid: str,
    referer: str,
    cookie_header: str,
) -> str:
    cached_key = _wbi_key_cache.get("key")
    cached_at = _safe_float(_wbi_key_cache.get("ts"))
    if isinstance(cached_key, str) and time.time() < cached_at + BILIBILI_WBI_CACHE_SECONDS:
        return cached_key

    try:
        payload = _fetch_bilibili_api_json(
            BILIBILI_NAV_API,
            referer=referer,
            cookie_header=cookie_header,
            allow_non_zero_code_with_data=True,
        )
    except HTTPException as error:
        raise _build_bilibili_error(
            "BILIBILI_WBI_FAILED",
            "B 站 WBI 签名参数获取失败，暂时无法请求播放流接口。",
        ) from error

    wbi_img = _as_dict(_as_dict(payload.get("data")).get("wbi_img"))
    lookup = "".join(
        _extract_wbi_key_from_url(_as_text(wbi_img.get(key)))
        for key in ("img_url", "sub_url")
    )
    if len(lookup) < 64:
        raise _build_bilibili_error(
            "BILIBILI_WBI_FAILED",
            "B 站 WBI 签名参数不完整，暂时无法请求播放流接口。",
        )

    mixin_key = "".join(lookup[index] for index in BILIBILI_MIXIN_KEY_ENC_TAB)[:32]
    _wbi_key_cache.update({"key": mixin_key, "ts": time.time()})
    return mixin_key


def _extract_wbi_key_from_url(source_url: str) -> str:
    filename = source_url.rsplit("/", 1)[-1]
    return filename.split(".", 1)[0]


def _extract_audio_streams(play_data: dict[str, Any]) -> list[BilibiliAudioStream]:
    dash = _as_dict(play_data.get("dash"))
    audio_items: list[dict[str, Any]] = []
    audio_items.extend(_as_dict_items(dash.get("audio")))
    audio_items.extend(_as_dict_items(_as_dict(dash.get("dolby")).get("audio")))
    flac_audio = _as_dict(_as_dict(dash.get("flac")).get("audio"))
    if flac_audio:
        audio_items.append(flac_audio)

    streams = [_build_audio_stream(item) for item in audio_items]
    valid_streams = [stream for stream in streams if stream is not None]
    return sorted(
        valid_streams,
        key=lambda item: (item.extension == "flac", item.bandwidth),
        reverse=True,
    )


def _select_best_audio_stream(
    audio_streams: list[BilibiliAudioStream],
) -> BilibiliAudioStream:
    return max(
        audio_streams,
        key=lambda item: (item.extension == "flac", item.bandwidth),
    )


def _extract_video_streams(play_data: dict[str, Any]) -> list[BilibiliVideoStream]:
    dash = _as_dict(play_data.get("dash"))
    descriptions = _build_support_format_descriptions(play_data)
    streams = [
        _build_video_stream(item, index, descriptions)
        for index, item in enumerate(_as_dict_items(dash.get("video")))
    ]
    valid_streams = [stream for stream in streams if stream is not None]
    return sorted(
        valid_streams,
        key=lambda item: (item.height, item.quality, item.bandwidth),
        reverse=True,
    )


def _build_audio_stream(audio: dict[str, Any]) -> BilibiliAudioStream | None:
    urls = _extract_stream_urls(audio)
    audio_url = urls[0] if urls else ""
    if not audio_url.startswith(("http://", "https://")):
        return None

    bandwidth = _safe_int(audio.get("bandwidth"))
    filesize = _optional_positive_int(audio.get("size"))
    codec = _as_text(audio.get("codecs")).lower() or "unknown"
    return BilibiliAudioStream(
        format_id=_build_audio_format_id(audio, codec, bandwidth),
        url=audio_url,
        urls=tuple(urls),
        extension=_get_audio_extension(audio, codec),
        codec=codec,
        bandwidth=bandwidth,
        filesize=filesize,
    )


def _build_video_stream(
    video: dict[str, Any],
    index: int,
    descriptions: dict[int, str],
) -> BilibiliVideoStream | None:
    urls = _extract_stream_urls(video)
    video_url = urls[0] if urls else ""
    if not video_url.startswith(("http://", "https://")):
        return None

    codec = _as_text(video.get("codecs")).lower() or "unknown"
    quality = _safe_int(video.get("id"))
    height = _safe_int(video.get("height"))
    width = _safe_int(video.get("width"))
    codecid = _safe_int(video.get("codecid") or video.get("codec_id"))
    bandwidth = _safe_int(video.get("bandwidth"))
    description = descriptions.get(quality) or _build_resolution_label(height)
    return BilibiliVideoStream(
        format_id=_build_video_format_id(quality, height, codecid, index),
        url=video_url,
        urls=tuple(urls),
        extension=_get_video_extension(video),
        codec=codec,
        quality=quality,
        width=width,
        height=height,
        bandwidth=bandwidth,
        filesize=_optional_positive_int(video.get("size")),
        description=description,
    )


def _extract_stream_urls(stream: dict[str, Any]) -> list[str]:
    candidates = [
        _as_text(stream.get("baseUrl")),
        _as_text(stream.get("base_url")),
        _as_text(stream.get("url")),
    ]
    candidates.extend(_as_text(item) for item in _as_list(stream.get("backupUrl")))
    candidates.extend(_as_text(item) for item in _as_list(stream.get("backup_url")))

    urls: list[str] = []
    for candidate in candidates:
        if not candidate.startswith(("http://", "https://")) or candidate in urls:
            continue

        urls.append(candidate)

    return urls


def _build_support_format_descriptions(play_data: dict[str, Any]) -> dict[int, str]:
    descriptions: dict[int, str] = {}
    for item in _as_dict_items(play_data.get("support_formats")):
        quality = _safe_int(item.get("quality"))
        description = (
            _as_text(item.get("new_description"))
            or _as_text(item.get("display_desc"))
            or _as_text(item.get("format"))
        )
        if quality > 0 and description:
            descriptions[quality] = description

    return descriptions


def _build_video_format_id(
    quality: int,
    height: int,
    codecid: int,
    index: int,
) -> str:
    quality_part = quality if quality > 0 else 0
    height_part = height if height > 0 else 0
    codecid_part = codecid if codecid > 0 else 0
    return f"{BILIBILI_VIDEO_FORMAT_PREFIX}{quality_part}_{height_part}_{codecid_part}_{index}"


def _build_audio_format_id(
    audio: dict[str, Any],
    codec: str,
    bandwidth: int,
) -> str:
    audio_id = _safe_int(audio.get("id"))
    codec_token = re.sub(r"[^a-zA-Z0-9]+", "_", codec).strip("_") or "unknown"
    bandwidth_part = bandwidth if bandwidth > 0 else 0
    return f"{BILIBILI_AUDIO_FORMAT_PREFIX}{audio_id}_{codec_token}_{bandwidth_part}"


def _get_audio_extension(audio: dict[str, Any], codec: str) -> str:
    mime_type = _as_text(audio.get("mimeType") or audio.get("mime_type")).lower()
    if "flac" in mime_type or "flac" in codec:
        return "flac"
    if "mpeg" in mime_type or codec.startswith("mp3"):
        return "mp3"
    if "mp4" in mime_type or "mp4a" in codec:
        return "m4a"
    return "m4a"


def _get_video_extension(video: dict[str, Any]) -> str:
    mime_type = _as_text(video.get("mimeType") or video.get("mime_type")).lower()
    if "webm" in mime_type:
        return "webm"

    return "mp4"


def _build_format_items(video: BilibiliVideo) -> list[dict[str, Any]]:
    formats: list[dict[str, Any]] = []
    for stream in _select_display_video_streams(video.video_streams):
        formats.append(
            {
                "format_id": stream.format_id,
                "ext": stream.extension,
                "resolution": _build_resolution_label(stream.height),
                "vcodec": stream.codec,
                "acodec": "none",
                "filesize": stream.filesize,
                "label": _build_video_format_label(stream),
            }
        )
        if len(formats) >= BILIBILI_MAX_FORMATS:
            return formats

    audio_streams = video.audio_streams or [video.audio]
    for stream in [_select_best_audio_stream(audio_streams)]:
        formats.append(
            {
                "format_id": stream.format_id,
                "ext": stream.extension,
                "resolution": "audio",
                "vcodec": "none",
                "acodec": stream.codec,
                "filesize": stream.filesize,
                "label": _build_audio_format_label(stream),
            }
        )
        if len(formats) >= BILIBILI_MAX_FORMATS:
            break

    return formats


def _select_display_video_streams(
    video_streams: list[BilibiliVideoStream],
) -> list[BilibiliVideoStream]:
    """
    同一清晰度只展示一个代表格式，优先选择播放兼容性更好的编码。
    """
    streams_by_height: dict[int, list[BilibiliVideoStream]] = {}
    for stream in video_streams:
        streams_by_height.setdefault(stream.height, []).append(stream)

    return [
        max(
            streams_by_height[height],
            key=lambda item: (_get_video_codec_priority(item.codec), item.bandwidth),
        )
        for height in sorted(streams_by_height, reverse=True)
    ]


def _get_video_codec_priority(codec: str) -> int:
    lowered_codec = codec.lower()
    if "avc" in lowered_codec:
        return 3
    if "hev" in lowered_codec or "hvc" in lowered_codec:
        return 2
    if "av01" in lowered_codec:
        return 1
    return 0


def _get_max_video_height(video_streams: list[BilibiliVideoStream]) -> int | None:
    max_height = max((stream.height for stream in video_streams), default=0)
    return max_height if max_height > 0 else None


def _build_resolution_label(height: int) -> str:
    return f"{height}p" if height > 0 else "未知清晰度"


def _build_video_format_label(stream: BilibiliVideoStream) -> str:
    resolution = _build_resolution_label(stream.height)
    return f"{resolution} 视频"


def _build_audio_format_label(stream: BilibiliAudioStream) -> str:
    if stream.extension == "flac":
        return "无损音频"

    return "仅音频"


def _build_codec_label(codec: str) -> str:
    lowered_codec = codec.lower()
    if "hev" in lowered_codec or "hvc" in lowered_codec:
        return "HEVC"
    if "av01" in lowered_codec:
        return "AV1"
    if "avc" in lowered_codec:
        return "AVC"
    if "flac" in lowered_codec:
        return "FLAC"
    if "mp4a" in lowered_codec:
        return "AAC"

    return codec or "unknown"


def _fetch_bilibili_api_json(
    source_url: str,
    *,
    referer: str,
    cookie_header: str | None = None,
    allow_non_zero_code_with_data: bool = False,
) -> dict[str, Any]:
    request = Request(
        source_url,
        headers=_build_api_request_headers(referer, cookie_header=cookie_header),
    )
    try:
        with urlopen(request, timeout=BILIBILI_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            payload = json.loads(response.read().decode(charset, errors="replace"))
    except HTTPError as error:
        status_code = int(error.code)
        logger.warning("bilibili api returned http status=%s", status_code)
        if status_code in BILIBILI_PLATFORM_REJECTED_STATUS_CODES:
            raise _build_bilibili_error(
                "BILIBILI_PLATFORM_REJECTED",
                "B 站拒绝了本地播放流请求，请稍后重试或换一个公开视频链接。",
            ) from error

        raise _build_bilibili_error(
            "BILIBILI_API_FETCH_FAILED",
            "B 站公开接口读取失败，请稍后重试。",
        ) from error
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        logger.warning("bilibili api fetch failed: %s", error.__class__.__name__)
        raise _build_bilibili_error(
            "BILIBILI_API_FETCH_FAILED",
            "B 站公开接口读取失败，请稍后重试。",
        ) from error

    if not isinstance(payload, dict):
        raise _build_bilibili_error(
            "BILIBILI_API_PARSE_FAILED",
            "B 站公开接口返回格式异常。",
        )

    code = _safe_int(payload.get("code"))
    if code == 0:
        return payload

    data = _as_dict(payload.get("data"))
    if allow_non_zero_code_with_data and data:
        logger.info("bilibili api returned business code=%s with usable data", code)
        return payload

    logger.warning("bilibili api returned business code=%s", code)
    if code in BILIBILI_ACCESS_RESTRICTED_CODES:
        raise _build_bilibili_error(
            "BILIBILI_ACCESS_RESTRICTED",
            "该 B 站内容需要登录、会员或额外权限，当前只支持无需登录的公开视频。",
        )

    raise _build_bilibili_error(
        "BILIBILI_API_REJECTED",
        "B 站公开接口本次未返回可用数据，请稍后重试或换一个公开视频链接。",
    )


def _build_api_request_headers(
    referer: str,
    *,
    cookie_header: str | None = None,
) -> dict[str, str]:
    headers = {
        "Accept": BILIBILI_JSON_ACCEPT_HEADER,
        "Accept-Encoding": "identity",
        "Accept-Language": BILIBILI_ACCEPT_LANGUAGE,
        "Connection": "close",
        "Origin": "https://www.bilibili.com",
        "Referer": referer,
        "User-Agent": DEFAULT_USER_AGENT,
    }
    if cookie_header:
        headers["Cookie"] = cookie_header

    return headers


def _build_audio_request_headers(
    referer: str,
    *,
    cookie_header: str,
) -> dict[str, str]:
    headers = {
        "Accept": "*/*",
        "Accept-Language": BILIBILI_ACCEPT_LANGUAGE,
        "Origin": "https://www.bilibili.com",
        "Referer": referer,
        "User-Agent": DEFAULT_USER_AGENT,
    }
    if cookie_header:
        headers["Cookie"] = cookie_header

    return headers


def _download_best_bilibili_format(video: BilibiliVideo) -> DownloadResponse:
    if not video.video_streams:
        return _download_single_bilibili_stream(
            video=video,
            urls=video.audio.urls,
            extension=video.audio.extension,
            format_selector=video.audio.format_id,
            message="B 站最佳可用音频已保存到本地目录。",
        )

    return _download_and_merge_bilibili_streams(
        video,
        _select_best_video_stream(video.video_streams),
        video.audio,
    )


def _select_best_video_stream(
    video_streams: list[BilibiliVideoStream],
) -> BilibiliVideoStream:
    return max(
        video_streams,
        key=lambda item: (
            item.height,
            item.quality,
            _get_video_codec_priority(item.codec),
            item.bandwidth,
        ),
    )


def _find_video_stream(
    video: BilibiliVideo,
    format_id: str,
) -> BilibiliVideoStream:
    for stream in video.video_streams:
        if stream.format_id == format_id:
            return stream

    fallback_stream = _find_video_stream_by_format_parts(video.video_streams, format_id)
    if fallback_stream is not None:
        return fallback_stream

    raise _build_bilibili_download_error(
        "FORMAT_UNAVAILABLE",
        "该 B 站视频格式当前不可下载，请重新解析后选择可用格式。",
    )


def _find_audio_stream(
    video: BilibiliVideo,
    format_id: str,
) -> BilibiliAudioStream:
    for stream in video.audio_streams:
        if stream.format_id == format_id:
            return stream

    raise _build_bilibili_download_error(
        "FORMAT_UNAVAILABLE",
        "该 B 站音频格式当前不可下载，请重新解析后选择可用格式。",
    )


def _find_video_stream_by_format_parts(
    video_streams: list[BilibiliVideoStream],
    format_id: str,
) -> BilibiliVideoStream | None:
    match = re.fullmatch(
        rf"{re.escape(BILIBILI_VIDEO_FORMAT_PREFIX)}(\d+)_(\d+)_(\d+)_\d+",
        format_id,
    )
    if not match:
        return None

    quality, height, codecid = (int(value) for value in match.groups())
    for stream in video_streams:
        current_codecid = _safe_int(stream.format_id.rsplit("_", 2)[1])
        if (
            stream.quality == quality
            and stream.height == height
            and current_codecid == codecid
        ):
            return stream

    return None


def _download_and_merge_bilibili_streams(
    video: BilibiliVideo,
    video_stream: BilibiliVideoStream,
    audio_stream: BilibiliAudioStream,
) -> DownloadResponse:
    ffmpeg_command = _get_ffmpeg_command()
    if ffmpeg_command is None:
        raise _build_bilibili_download_error(
            "FFMPEG_NOT_FOUND",
            "该格式是 DASH 分离音视频，需要本机安装 ffmpeg 后才能合并。",
        )

    download_dir = _get_download_dir()
    output_path = _build_unique_download_path(
        download_dir,
        video,
        _get_merge_output_format(),
    )
    video_path = output_path.with_suffix(f".video.{video_stream.extension}.tmp")
    audio_path = output_path.with_suffix(f".audio.{audio_stream.extension}.tmp")

    try:
        _download_bilibili_stream(video_stream.urls, video, video_path)
        _download_bilibili_stream(audio_stream.urls, video, audio_path)
        _merge_bilibili_streams(ffmpeg_command, video_path, audio_path, output_path)
    except (HTTPException, OSError, subprocess.SubprocessError) as error:
        _safe_unlink(video_path)
        _safe_unlink(audio_path)
        _safe_unlink(output_path)
        if isinstance(error, HTTPException):
            raise

        logger.warning("bilibili download merge failed: %s", error.__class__.__name__)
        raise _build_bilibili_download_error(
            "DOWNLOAD_FAILED",
            "B 站音视频下载或合并失败，请稍后重试。",
        ) from error

    _safe_unlink(video_path)
    _safe_unlink(audio_path)
    return DownloadResponse(
        filename=output_path.name,
        file_path=str(output_path),
        format_selector=f"{video_stream.format_id}+{audio_stream.format_id}",
        message="B 站 DASH 音视频已合并保存到本地目录。",
    )


def _download_single_bilibili_stream(
    *,
    video: BilibiliVideo,
    urls: tuple[str, ...],
    extension: str,
    format_selector: str,
    message: str,
) -> DownloadResponse:
    download_dir = _get_download_dir()
    output_path = _build_unique_download_path(download_dir, video, extension)
    temporary_path = output_path.with_suffix(f".{extension}.tmp")
    try:
        _download_bilibili_stream(urls, video, temporary_path)
        temporary_path.replace(output_path)
    except (HTTPException, OSError) as error:
        _safe_unlink(temporary_path)
        if isinstance(error, HTTPException):
            raise

        logger.warning("bilibili single stream download failed: %s", error.__class__.__name__)
        raise _build_bilibili_download_error(
            "DOWNLOAD_FAILED",
            "B 站媒体流下载失败，请稍后重试。",
        ) from error

    return DownloadResponse(
        filename=output_path.name,
        file_path=str(output_path),
        format_selector=format_selector,
        message=message,
    )


def _download_bilibili_stream(
    urls: tuple[str, ...],
    video: BilibiliVideo,
    target_path: Path,
) -> None:
    last_error: Exception | None = None
    for source_url in urls:
        request = Request(
            source_url,
            headers=_build_audio_request_headers(
                video.source_url,
                cookie_header=video.cookie_header,
            ),
        )
        try:
            with urlopen(request, timeout=BILIBILI_TIMEOUT_SECONDS) as response:
                with target_path.open("wb") as output_file:
                    while True:
                        chunk = response.read(BILIBILI_DOWNLOAD_CHUNK_SIZE)
                        if not chunk:
                            break

                        output_file.write(chunk)
            return
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            last_error = error
            logger.warning(
                "bilibili stream download candidate failed: %s",
                error.__class__.__name__,
            )
            _safe_unlink(target_path)

    if isinstance(last_error, HTTPError) and int(last_error.code) in BILIBILI_PLATFORM_REJECTED_STATUS_CODES:
        raise _build_bilibili_download_error(
            "BILIBILI_PLATFORM_REJECTED",
            "B 站拒绝了本地媒体流下载请求，请稍后重试或换一个公开视频链接。",
        ) from last_error

    raise _build_bilibili_download_error(
        "DOWNLOAD_FAILED",
        "B 站媒体流下载失败，请稍后重试。",
    )


def _merge_bilibili_streams(
    ffmpeg_command: str,
    video_path: Path,
    audio_path: Path,
    output_path: Path,
) -> None:
    command = [
        ffmpeg_command,
        "-y",
        "-i",
        str(video_path),
        "-i",
        str(audio_path),
        "-c",
        "copy",
        str(output_path),
    ]
    completed_process = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=BILIBILI_FFMPEG_TIMEOUT_SECONDS,
    )
    if completed_process.returncode != 0:
        logger.warning("bilibili ffmpeg merge failed")
        raise _build_bilibili_download_error(
            "FFMPEG_MERGE_FAILED",
            "ffmpeg 合并 B 站音视频失败，请检查本机 ffmpeg 配置。",
        )


def _get_download_dir() -> Path:
    configured_dir = str(os.getenv("YTDLP_DOWNLOAD_DIR") or "").strip()
    if configured_dir:
        download_dir = Path(configured_dir).expanduser()
    else:
        download_dir = Path(__file__).resolve().parents[2] / "data" / "downloads"

    download_dir.mkdir(parents=True, exist_ok=True)
    return download_dir.resolve()


def _build_unique_download_path(
    download_dir: Path,
    video: BilibiliVideo,
    extension: str,
) -> Path:
    timestamp = int(time.time())
    title = _sanitize_filename(video.title)[:80]
    bvid = _sanitize_filename(video.bvid)
    filename = f"{title} [{bvid}] {timestamp}.{extension}"
    candidate = download_dir / filename
    index = 1
    while candidate.exists() or candidate.suffix.lower() in DOWNLOAD_TEMP_SUFFIXES:
        candidate = download_dir / f"{title} [{bvid}] {timestamp}-{index}.{extension}"
        index += 1

    return candidate


def _sanitize_filename(value: str) -> str:
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    return sanitized or "bilibili-video"


def _get_merge_output_format() -> str:
    configured_format = str(os.getenv("YTDLP_MERGE_OUTPUT_FORMAT") or "").strip()
    if configured_format in SUPPORTED_MERGE_OUTPUT_FORMATS:
        return configured_format

    return "mp4"


def _get_ffmpeg_command() -> str | None:
    ffmpeg_location = str(os.getenv("FFMPEG_LOCATION") or "").strip()
    if ffmpeg_location:
        configured_path = Path(ffmpeg_location).expanduser()
        if configured_path.is_dir():
            for executable_name in ("ffmpeg.exe", "ffmpeg"):
                executable_path = configured_path / executable_name
                if executable_path.exists():
                    return str(executable_path)
        if configured_path.exists():
            return str(configured_path)

    return shutil.which("ffmpeg")


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.debug("bilibili temporary file cleanup skipped")


def _build_cookie_header(
    cookies: BilibiliSessionCookies,
    *,
    explicit_cookies: dict[str, str] | None = None,
) -> str:
    cookie_values = dict(explicit_cookies or {})
    if cookies.buvid3:
        cookie_values.setdefault("buvid3", cookies.buvid3)
    if cookies.buvid4:
        cookie_values.setdefault("buvid4", cookies.buvid4)

    return "; ".join(
        f"{name}={value}"
        for name, value in cookie_values.items()
        if name and value
    )


def _format_cookie_header(cookie_values: dict[str, str]) -> str:
    return "; ".join(
        f"{name}={value}"
        for name, value in cookie_values.items()
        if name and value
    )


def _load_explicit_bilibili_cookies() -> dict[str, str]:
    return _load_explicit_bilibili_cookie_bundle().cookies


def _load_explicit_bilibili_cookie_bundle() -> BilibiliCookieBundle:
    """
    二阶段入口：仅在显式开关开启时读取本地 B 站 Cookie。
    """
    cookie_path = _get_configured_cookie_file_path()
    if not _is_cookie_options_enabled():
        return BilibiliCookieBundle(
            cookies={},
            source=None,
            file_configured=cookie_path is not None,
        )

    if cookie_path is None:
        return BilibiliCookieBundle(cookies={}, source=None, file_configured=False)
    if not cookie_path.exists():
        logger.warning("bilibili explicit cookie file not found")
        return BilibiliCookieBundle(
            cookies={},
            source="configured_cookie_file",
            file_configured=True,
        )

    try:
        cookies = _parse_bilibili_cookie_file(cookie_path)
    except OSError as error:
        logger.warning("bilibili explicit cookie file read failed: %s", error.__class__.__name__)
        cookies = {}

    return BilibiliCookieBundle(
        cookies=cookies,
        source="configured_cookie_file",
        file_configured=True,
    )


def _parse_bilibili_cookie_file(cookie_path: Path) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for raw_line in cookie_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("# Netscape"):
            continue

        for domain, name, value in _parse_cookie_line(line):
            if (
                BILIBILI_COOKIE_DOMAIN_MARKER not in domain.lower()
                or not name
                or not value
            ):
                continue

            cookies[name] = value

    if cookies:
        logger.info("bilibili explicit cookie file loaded")
    return cookies


def _parse_cookie_line(line: str) -> list[tuple[str, str, str]]:
    normalized_line = line.removeprefix("#HttpOnly_")
    parsed_url = urlparse(normalized_line)
    if parsed_url.scheme in {"http", "https"} and parsed_url.query:
        return [
            (
                BILIBILI_COOKIE_DOMAIN_MARKER,
                name.strip(),
                value.strip().replace(",", "%2c"),
            )
            for name, value in parse_qsl(parsed_url.query, keep_blank_values=False)
            if name not in {"Expires", "gourl"}
        ]

    parts = normalized_line.split("\t")
    if len(parts) >= 7:
        domain, _, _, _, _, name, value = parts[:7]
        return [(domain, name.strip(), value.strip())]

    if "=" not in normalized_line:
        return []

    cookies = []
    for cookie_pair in normalized_line.split(";"):
        name, separator, value = cookie_pair.strip().partition("=")
        if separator:
            cookies.append(
                (BILIBILI_COOKIE_DOMAIN_MARKER, name.strip(), value.strip())
            )
    return cookies


def _is_cookie_options_enabled() -> bool:
    bilibili_value = str(os.getenv(BILIBILI_ENABLE_COOKIE_OPTIONS_ENV) or "").strip()
    if bilibili_value:
        return _is_truthy_env_value(bilibili_value)

    return _is_truthy_env_value(str(os.getenv("YTDLP_ENABLE_COOKIE_OPTIONS") or ""))


def _has_explicit_cookie_config() -> bool:
    return _is_cookie_options_enabled() and _get_configured_cookie_file_path() is not None


def _get_configured_cookie_file_path() -> Path | None:
    cookie_file = (
        str(os.getenv(BILIBILI_COOKIE_FILE_ENV) or "").strip()
        or str(os.getenv("YTDLP_COOKIE_FILE") or "").strip()
    )
    if not cookie_file:
        return None

    return Path(cookie_file).expanduser()


def _is_truthy_env_value(value: str) -> bool:
    value = value.strip().lower()
    return value in {"1", "true", "yes", "on"}


def _select_video_page(
    view_data: dict[str, Any],
    source_url: str,
) -> dict[str, Any]:
    pages = _as_dict_items(view_data.get("pages"))
    if not pages:
        return {}

    page_index = _get_requested_page_index(source_url)
    if 0 <= page_index < len(pages):
        return pages[page_index]

    return pages[0]


def _get_requested_page_index(source_url: str) -> int:
    query = parse_qs(urlparse(source_url).query)
    page_value = _first_text(query.get("p"))
    page_number = _safe_int(page_value)
    return max(0, page_number - 1)


def _extract_bvid(source_url: str) -> str | None:
    match = re.search(BILIBILI_BVID_PATTERN, source_url)
    return match.group(0) if match else None


def _normalize_thumbnail_url(thumbnail_url: str) -> str:
    if not thumbnail_url:
        return PLACEHOLDER_THUMBNAIL
    if thumbnail_url.startswith("//"):
        return f"https:{thumbnail_url}"
    return thumbnail_url


def _build_summary_placeholder(video: BilibiliVideo) -> dict[str, Any]:
    return {
        "tldr": "已通过 B 站专用接口获取公开元数据、DASH 音频和可下载格式。",
        "key_points": [
            "已读取 BVID、CID、标题、作者、时长和封面。",
            "已拿到 DASH audio URL，可用于本地 Whisper 生成 AI 转写稿。",
            "已整理公开视频 DASH video / audio 候选，下载时可用 ffmpeg 合并音视频。",
            "当前阶段不处理 DRM、付费、私密、会员专属或无授权内容。",
        ],
        "timeline": [],
        "structured_analysis_markdown": (
            "## 当前阶段\n"
            "### 已完成\n"
            "B 站公开视频元数据和 DASH 音频流解析。\n"
            "### 可继续\n"
            "在内容文本页生成 AI 转写稿。\n"
            "### 未接入\n"
            "登录管理、aria2、断点续传、多 P、字幕和封面批量下载。"
        ),
        "takeaways": [
            "B 站专用链路优先服务 AI 转写，不替代完整下载器。",
            "显式本地 Cookie 能力默认关闭，只在用户主动配置时参与请求。",
        ],
    }


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_dict_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _first_text(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            text = _as_text(item)
            if text:
                return text
    return _as_text(value)


def _optional_positive_int(value: Any) -> int | None:
    parsed_value = _safe_int(value)
    return parsed_value if parsed_value > 0 else None


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def _build_bilibili_error(error_code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"success": False, "error_code": error_code, "message": message},
    )


def _build_bilibili_download_error(
    error_code: str,
    message: str,
    status_code: int = 400,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"success": False, "error_code": error_code, "message": message},
    )
