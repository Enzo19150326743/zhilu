import hashlib
import json
import logging
import multiprocessing
import os
import queue
import re
import shutil
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from fastapi import HTTPException
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, ExtractorError

from app.schemas import DownloadResponse, FormatDiagnostics, ParseResponse
from app.services.http_fetch_service import DEFAULT_USER_AGENT
from app.services.transcript_service import extract_transcript_payload

logger = logging.getLogger(__name__)

MAX_FORMATS = 16
MAX_AUDIO_FORMATS = 3
YT_DLP_TOTAL_TIMEOUT_SECONDS = 30
PLATFORM_RETRY_MAX_ATTEMPTS = 3
PLATFORM_RETRY_DELAY_SECONDS = 1.0
DOWNLOAD_OUTPUT_TEMPLATE = "%(title).160B [%(id)s] %(epoch)s.%(ext)s"
SAFE_FORMAT_ID_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    "._:-"
)
DOWNLOAD_TEMP_SUFFIXES = {".part", ".ytdl", ".tmp", ".temp"}
SUPPORTED_MERGE_OUTPUT_FORMATS = {"mp4", "mkv", "webm"}
BILIBILI_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8"
BILIBILI_BVID_PATTERN = re.compile(r"BV[a-zA-Z0-9]{10}")
BILIBILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view"
BILIBILI_JSON_ACCEPT_HEADER = "application/json,text/plain,*/*"
BILIBILI_PUBLIC_METADATA_SOURCE = "bilibili_public_view"
BILIBILI_PUBLIC_METADATA_TIMEOUT_SECONDS = 15
PLACEHOLDER_THUMBNAIL = (
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3"
    "?auto=format&fit=crop&w=900&q=80"
)
YtdlpWorker = Callable[[str, dict[str, Any], Any], None]
RawInfoExtractor = Callable[[str, dict[str, Any]], dict[str, Any]]


def extract_video_metadata(video_url: str) -> ParseResponse:
    """
    使用 yt-dlp 获取公开媒体元数据。

    NOTE: 当前阶段只做 metadata、formats 和内容文本预览，不调用 AI、不写缓存、不下载媒体文件。
    """
    options = _build_extract_options(video_url)
    has_cookie_options = _apply_cookie_options(options)

    try:
        raw_info = _extract_raw_info_with_retries(video_url, options)
    except HTTPException as error:
        fallback_response = _try_bilibili_public_metadata_fallback(video_url, error)
        if fallback_response is not None:
            return fallback_response

        if not has_cookie_options or not _is_cookie_load_http_error(error):
            raise

        logger.warning("yt-dlp cookie load failed, retrying anonymously")
        raw_info = _extract_raw_info_with_retries(
            video_url,
            _without_cookie_options(options),
        )

    if not isinstance(raw_info, dict):
        raise _build_parse_error("PARSE_FAILED", "解析失败，未获取到有效媒体信息。")

    if has_cookie_options:
        raw_info = _prefer_public_formats_when_better(video_url, raw_info, options)

    return _build_parse_response(video_url, raw_info)


def _build_extract_options(video_url: str) -> dict[str, Any]:
    """
    构造 yt-dlp 元数据解析选项；B 站公开页按浏览器请求条件访问。
    """
    options: dict[str, Any] = {
        "extract_flat": False,
        "extractor_retries": 1,
        "fragment_retries": 1,
        "noplaylist": True,
        "no_warnings": True,
        "quiet": True,
        "retries": 1,
        "skip_download": True,
        "socket_timeout": 15,
    }
    if _is_bilibili_url(video_url):
        options["http_headers"] = {
            "Accept-Language": BILIBILI_ACCEPT_LANGUAGE,
            "Referer": video_url,
            "User-Agent": DEFAULT_USER_AGENT,
        }

    return options


def download_video_format(
    video_url: str,
    format_id: str,
    merge_with_audio: bool,
) -> DownloadResponse:
    """
    使用 yt-dlp 下载指定格式到本地受控目录。
    """
    format_selector = _build_download_format_selector(format_id, merge_with_audio)
    if merge_with_audio and not _is_ffmpeg_available():
        raise _build_download_error(
            "FFMPEG_NOT_FOUND",
            "该格式是仅视频流，需要本机安装 ffmpeg 后才能合并音频。",
        )

    download_dir = _get_download_dir()
    before_snapshot = _snapshot_download_dir(download_dir)
    options = _build_download_options(download_dir, format_selector)
    has_cookie_options = _apply_cookie_options(options)

    try:
        with YoutubeDL(options) as youtube_dl:
            youtube_dl.extract_info(video_url, download=True)
    except (DownloadError, ExtractorError, OSError, TimeoutError) as error:
        if not has_cookie_options:
            _raise_ytdlp_download_error(error)

        logger.warning("yt-dlp download failed with debug cookies, retrying publicly")
        try:
            with YoutubeDL(_without_cookie_options(options)) as youtube_dl:
                youtube_dl.extract_info(video_url, download=True)
        except (DownloadError, ExtractorError, OSError, TimeoutError) as fallback_error:
            _raise_ytdlp_download_error(fallback_error)

    downloaded_path = _find_downloaded_file(download_dir, before_snapshot)
    return DownloadResponse(
        filename=downloaded_path.name,
        file_path=str(downloaded_path),
        format_selector=format_selector,
        message="下载已保存到本地目录。",
    )


def _prefer_public_formats_when_better(
    video_url: str,
    raw_info: dict[str, Any],
    options: dict[str, Any],
) -> dict[str, Any]:
    """
    Cookie 只作为本地调试入口；公开视频清晰度以平台公开 formats 为产品主路径。
    """
    if not _is_bilibili_source(video_url, raw_info):
        return raw_info

    current_max_height = _get_raw_max_height(raw_info)
    if current_max_height >= 720:
        return raw_info

    try:
        public_raw_info = _extract_raw_info_with_retries(
            video_url,
            _without_cookie_options(options),
        )
    except HTTPException:
        logger.warning("public format retry failed after debug cookie result")
        return raw_info

    if not isinstance(public_raw_info, dict):
        return raw_info

    public_max_height = _get_raw_max_height(public_raw_info)
    if public_max_height > current_max_height:
        logger.info("using public formats because they expose higher resolution")
        return public_raw_info

    return raw_info


def _get_raw_max_height(raw_info: dict[str, Any]) -> int:
    raw_formats = raw_info.get("formats")
    if not isinstance(raw_formats, list):
        return 0

    heights = [
        _safe_int(raw_format.get("height"))
        for raw_format in raw_formats
        if isinstance(raw_format, dict)
    ]
    return max([height for height in heights if height > 0], default=0)


def _build_download_format_selector(format_id: str, merge_with_audio: bool) -> str:
    clean_format_id = format_id.strip()
    if not clean_format_id or any(
        character not in SAFE_FORMAT_ID_CHARS for character in clean_format_id
    ):
        raise _build_download_error(
            "INVALID_FORMAT_ID",
            "下载格式标识不正确，请重新解析后再选择格式。",
        )

    if clean_format_id == "best":
        if _is_ffmpeg_available():
            return "bestvideo+bestaudio/best"

        return "best"

    if merge_with_audio:
        return f"{clean_format_id}+bestaudio/best"

    return clean_format_id


def _get_download_dir() -> Path:
    configured_dir = str(os.getenv("YTDLP_DOWNLOAD_DIR") or "").strip()
    if configured_dir:
        download_dir = Path(configured_dir).expanduser()
    else:
        download_dir = Path(__file__).resolve().parents[2] / "data" / "downloads"

    download_dir.mkdir(parents=True, exist_ok=True)
    return download_dir.resolve()


def _build_download_options(download_dir: Path, format_selector: str) -> dict[str, Any]:
    options: dict[str, Any] = {
        "continuedl": True,
        "extract_flat": False,
        "format": format_selector,
        "fragment_retries": 2,
        "merge_output_format": _get_merge_output_format(),
        "noplaylist": True,
        "no_warnings": True,
        "outtmpl": str(download_dir / DOWNLOAD_OUTPUT_TEMPLATE),
        "quiet": True,
        "retries": 2,
        "socket_timeout": 30,
        "windowsfilenames": True,
    }
    ffmpeg_location = str(os.getenv("FFMPEG_LOCATION") or "").strip()
    if ffmpeg_location:
        options["ffmpeg_location"] = ffmpeg_location

    return options


def _get_merge_output_format() -> str:
    configured_format = str(os.getenv("YTDLP_MERGE_OUTPUT_FORMAT") or "").strip()
    if configured_format in SUPPORTED_MERGE_OUTPUT_FORMATS:
        return configured_format

    return "mp4"


def _is_ffmpeg_available() -> bool:
    ffmpeg_location = str(os.getenv("FFMPEG_LOCATION") or "").strip()
    if ffmpeg_location and Path(ffmpeg_location).expanduser().exists():
        return True

    return shutil.which("ffmpeg") is not None


def _snapshot_download_dir(download_dir: Path) -> dict[Path, int]:
    snapshot: dict[Path, int] = {}
    for path in download_dir.iterdir():
        if not path.is_file():
            continue

        try:
            snapshot[path] = path.stat().st_mtime_ns
        except OSError:
            logger.debug("download snapshot skipped unreadable file")

    return snapshot


def _find_downloaded_file(download_dir: Path, before_snapshot: dict[Path, int]) -> Path:
    candidates: list[Path] = []
    for path in download_dir.iterdir():
        if not path.is_file() or path.suffix.lower() in DOWNLOAD_TEMP_SUFFIXES:
            continue

        try:
            modified_at = path.stat().st_mtime_ns
        except OSError:
            logger.debug("download result skipped unreadable file")
            continue

        if path not in before_snapshot or before_snapshot[path] != modified_at:
            candidates.append(path)

    if not candidates:
        raise _build_download_error(
            "DOWNLOAD_FILE_NOT_FOUND",
            "下载过程已结束，但未能定位保存后的文件。",
            status_code=500,
        )

    return max(candidates, key=lambda candidate: candidate.stat().st_mtime_ns)


def _raise_ytdlp_download_error(error: Exception) -> None:
    """
    将 yt-dlp 下载失败转换为稳定的前端提示。
    """
    normalized_message = str(error).lower()
    if _is_cookie_load_error(normalized_message):
        logger.warning("yt-dlp download cookie load failed")
        raise _build_download_error(
            "COOKIE_LOAD_FAILED",
            "本地调试 Cookie 读取失败，请关闭调试 Cookie 后重试。",
        )

    if _is_ffmpeg_error(normalized_message):
        logger.warning("yt-dlp download ffmpeg failed")
        raise _build_download_error(
            "FFMPEG_NOT_FOUND",
            "该格式需要 ffmpeg 合并音视频，请安装 ffmpeg 或配置 FFMPEG_LOCATION。",
        )

    if _is_download_access_restricted_error(normalized_message):
        logger.warning("yt-dlp download access restricted")
        raise _build_download_error(
            "ACCESS_RESTRICTED",
            "该内容需要额外权限或存在访问限制，当前只支持你有权访问的公开媒体内容。",
        )

    if "requested format is not available" in normalized_message:
        logger.warning("yt-dlp requested format unavailable")
        raise _build_download_error(
            "FORMAT_UNAVAILABLE",
            "该格式当前不可下载，请重新解析后选择可用格式。",
        )

    if _is_platform_rejected_error(normalized_message):
        logger.warning("yt-dlp download rejected by platform")
        raise _build_download_error(
            "PLATFORM_REJECTED",
            "平台拒绝了本地下载请求，请稍后重试或换一个公开媒体链接。",
        )

    logger.warning("yt-dlp download failed: %s", error.__class__.__name__)
    raise _build_download_error("DOWNLOAD_FAILED", "下载失败，请稍后重试。")


def _is_ffmpeg_error(normalized_message: str) -> bool:
    ffmpeg_markers = (
        "ffmpeg is not installed",
        "ffmpeg not found",
        "postprocessing: ffmpeg",
        "ffprobe",
    )
    return any(marker in normalized_message for marker in ffmpeg_markers)


def _is_download_access_restricted_error(normalized_message: str) -> bool:
    restricted_markers = (
        "drm",
        "paid",
        "premium",
        "会员",
        "付费",
    )
    return _is_access_restricted_error(normalized_message) or any(
        marker in normalized_message for marker in restricted_markers
    )


def _extract_raw_info_with_retries(
    video_url: str,
    options: dict[str, Any],
    max_attempts: int = PLATFORM_RETRY_MAX_ATTEMPTS,
    retry_delay_seconds: float = PLATFORM_RETRY_DELAY_SECONDS,
    extractor: RawInfoExtractor = None,
) -> dict[str, Any]:
    """
    对平台快速拒绝做窄范围重试，降低 B 站 412 间歇性失败的体感。
    """
    active_extractor = extractor or _extract_raw_info_with_timeout
    for attempt in range(1, max_attempts + 1):
        try:
            return active_extractor(video_url, options)
        except HTTPException as error:
            if not _should_retry_parse_error(error, attempt, max_attempts):
                raise

            logger.warning(
                "retrying after platform rejection: attempt %s/%s",
                attempt,
                max_attempts,
            )
            if retry_delay_seconds > 0:
                time.sleep(retry_delay_seconds)

    raise _build_parse_error("PARSE_FAILED", "解析失败，请稍后重试。")


def _should_retry_parse_error(
    error: HTTPException, attempt: int, max_attempts: int
) -> bool:
    detail = error.detail
    if not isinstance(detail, dict):
        return False

    return (
        detail.get("error_code") == "PLATFORM_REJECTED"
        and attempt < max_attempts
    )


def _extract_raw_info_with_timeout(
    video_url: str,
    options: dict[str, Any],
    timeout_seconds: float = YT_DLP_TOTAL_TIMEOUT_SECONDS,
    worker_target: YtdlpWorker = None,
) -> dict[str, Any]:
    """
    在独立子进程中运行 yt-dlp，避免外部平台卡住时拖死 FastAPI 进程。
    """
    target = worker_target or _yt_dlp_extract_worker
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(
        target=target,
        args=(video_url, options, result_queue),
        daemon=True,
    )
    process.start()
    result: dict[str, Any] | None = None
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        remaining_seconds = deadline - time.monotonic()
        if remaining_seconds <= 0:
            break

        try:
            result = result_queue.get(timeout=min(0.1, remaining_seconds))
            break
        except queue.Empty:
            if not process.is_alive():
                break

    if result is not None:
        process.join(2)
        if process.is_alive():
            process.terminate()
            process.join(1)

    if result is None and process.is_alive():
        process.terminate()
        process.join(2)
        if process.is_alive():
            process.kill()
            process.join(1)

        _close_result_queue(result_queue)
        logger.warning("yt-dlp parse exceeded deadline: %ss", timeout_seconds)
        raise _build_parse_error("PARSE_TIMEOUT", "解析超时，请稍后重试。")

    if result is None:
        try:
            result = result_queue.get_nowait()
        except queue.Empty as error:
            _close_result_queue(result_queue)
            logger.warning("yt-dlp worker exited without result")
            raise _build_parse_error("PARSE_FAILED", "解析失败，未获取到有效媒体信息。") from error

    _close_result_queue(result_queue)
    if not isinstance(result, dict):
        raise _build_parse_error("PARSE_FAILED", "解析失败，未获取到有效媒体信息。")

    if result.get("status") == "ok":
        raw_info = result.get("raw_info")
        if isinstance(raw_info, dict):
            return raw_info
        raise _build_parse_error("PARSE_FAILED", "解析失败，未获取到有效媒体信息。")

    _raise_ytdlp_error_result(result)


def _raise_ytdlp_error_result(result: dict[str, Any]) -> None:
    """
    将 yt-dlp 的常见失败原因映射成用户可理解的稳定错误。
    """
    error_type = str(result.get("error_type") or "")
    error_message = str(result.get("message") or "")
    normalized_message = error_message.lower()
    if "timed out" in normalized_message or "timeout" in normalized_message:
        logger.warning("yt-dlp parse timed out: %s", error_type)
        raise _build_parse_error("PARSE_TIMEOUT", "解析超时，请稍后重试。")

    if _is_cookie_load_error(normalized_message):
        logger.warning("yt-dlp cookie load failed: %s", error_type)
        raise _build_parse_error(
            "COOKIE_LOAD_FAILED",
            "本地调试 Cookie 读取失败，请关闭调试 Cookie 后重试。",
        )

    if _is_access_restricted_error(normalized_message):
        logger.warning("yt-dlp access restricted: %s", error_type)
        raise _build_parse_error(
            "ACCESS_RESTRICTED",
            "该内容需要登录、验证或权限确认，当前版本仅支持无需登录的公开媒体内容。",
        )

    if _is_platform_rejected_error(normalized_message):
        logger.warning(
            "yt-dlp platform rejected request: %s; host=%s; headers=%s; message=%s",
            error_type,
            str(result.get("url_host") or "unknown"),
            ", ".join(result.get("http_header_names") or []) or "none",
            _compact_log_message(error_message),
        )
        raise _build_parse_error(
            "PLATFORM_REJECTED",
            "平台拒绝了本地解析请求，请换一个公开媒体链接或稍后重试。",
        )

    if error_type == "ExtractorError":
        logger.warning("yt-dlp extractor failed")
        raise _build_parse_error("PARSE_FAILED", "解析失败，请换一个公开媒体链接重试。")

    if error_type == "DownloadError":
        logger.warning("yt-dlp download failed")
        raise _build_parse_error("PARSE_FAILED", "解析失败，请确认该内容是可公开访问的媒体内容。")

    logger.warning("yt-dlp failed: %s", error_type or "unknown")
    raise _build_parse_error("PARSE_FAILED", "解析失败，请稍后重试。")


def _is_cookie_load_http_error(error: HTTPException) -> bool:
    detail = error.detail
    return isinstance(detail, dict) and detail.get("error_code") == "COOKIE_LOAD_FAILED"


def _is_cookie_load_error(normalized_message: str) -> bool:
    cookie_markers = (
        "could not copy chrome cookie database",
        "could not copy",
        "cookie database",
        "cookie load",
        "failed to decrypt",
    )
    return any(marker in normalized_message for marker in cookie_markers)


def _is_access_restricted_error(normalized_message: str) -> bool:
    restricted_markers = (
        "sign in",
        "login",
        "not a bot",
        "captcha",
        "verify",
        "verification",
        "private",
        "members-only",
        "age-restricted",
        "需要登录",
        "登录",
        "验证",
        "权限",
        "私密",
    )
    return any(marker in normalized_message for marker in restricted_markers)


def _is_platform_rejected_error(normalized_message: str) -> bool:
    rejected_markers = (
        "http error 403",
        "http error 412",
        "forbidden",
        "precondition failed",
        "too many requests",
        "http error 429",
    )
    return any(marker in normalized_message for marker in rejected_markers)


def _compact_log_message(message: str, max_length: int = 500) -> str:
    compacted = " ".join(message.split())
    if len(compacted) <= max_length:
        return compacted

    return f"{compacted[:max_length]}..."


def _try_bilibili_public_metadata_fallback(
    video_url: str, error: HTTPException
) -> ParseResponse | None:
    """
    B 站播放地址接口偶发 412 时，降级保留公开元数据解析能力。
    """
    if not _is_bilibili_url(video_url) or not _is_platform_rejected_http_error(error):
        return None

    try:
        raw_info = _fetch_bilibili_public_raw_info(video_url)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as fallback_error:
        logger.warning(
            "bilibili public metadata fallback failed: %s",
            fallback_error.__class__.__name__,
        )
        return None

    logger.warning("bilibili playurl rejected; using public metadata fallback")
    return _build_parse_response(video_url, raw_info)


def _is_platform_rejected_http_error(error: HTTPException) -> bool:
    detail = error.detail
    return isinstance(detail, dict) and detail.get("error_code") == "PLATFORM_REJECTED"


def _fetch_bilibili_public_raw_info(video_url: str) -> dict[str, Any]:
    bvid = _extract_bilibili_bvid(video_url)
    if bvid is None:
        raise ValueError("bilibili bvid is missing")

    referer = f"https://www.bilibili.com/video/{bvid}"
    view_data = _fetch_bilibili_api_json(
        f"{BILIBILI_VIEW_API}?{urlencode({'bvid': bvid})}",
        referer,
    )
    media_data = _get_dict(view_data.get("data"))
    if not media_data:
        raise ValueError("bilibili view api data is empty")

    owner = _get_dict(media_data.get("owner"))
    first_page = _get_first_bilibili_page(media_data)
    cid = _safe_int(media_data.get("cid")) or _safe_int(first_page.get("cid")) or None
    duration = _safe_int(media_data.get("duration")) or _safe_int(
        first_page.get("duration")
    )

    return {
        "_metadata_source": BILIBILI_PUBLIC_METADATA_SOURCE,
        "id": bvid,
        "extractor": "BiliBili",
        "extractor_key": "BiliBili",
        "webpage_url": referer,
        "original_url": video_url,
        "aid": media_data.get("aid"),
        "cid": cid,
        "title": str(media_data.get("title") or "未命名媒体内容"),
        "uploader": str(owner.get("name") or "未知作者"),
        "uploader_id": str(owner.get("mid") or ""),
        "duration": duration,
        "thumbnail": media_data.get("pic"),
        "description": str(media_data.get("desc") or ""),
        "timestamp": _safe_int(media_data.get("pubdate")),
        "formats": [],
        "pages": (
            media_data.get("pages") if isinstance(media_data.get("pages"), list) else []
        ),
    }


def _fetch_bilibili_api_json(source_url: str, referer: str) -> dict[str, Any]:
    request = Request(
        source_url,
        headers={
            "Accept": BILIBILI_JSON_ACCEPT_HEADER,
            "Accept-Encoding": "identity",
            "Accept-Language": BILIBILI_ACCEPT_LANGUAGE,
            "Referer": referer,
            "User-Agent": DEFAULT_USER_AGENT,
        },
    )
    with urlopen(request, timeout=BILIBILI_PUBLIC_METADATA_TIMEOUT_SECONDS) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        payload = json.loads(response.read().decode(charset, errors="replace"))

    if not isinstance(payload, dict):
        raise ValueError("bilibili api response is not an object")
    if _safe_int(payload.get("code")) != 0:
        raise ValueError("bilibili api returned non-zero code")

    return payload


def _extract_bilibili_bvid(video_url: str) -> str | None:
    match = BILIBILI_BVID_PATTERN.search(video_url)
    return match.group(0) if match else None


def _get_first_bilibili_page(media_data: dict[str, Any]) -> dict[str, Any]:
    pages = media_data.get("pages")
    if not isinstance(pages, list) or not pages:
        return {}

    return _get_dict(pages[0])


def _get_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _build_ytdlp_worker_diagnostics(
    video_url: str, options: dict[str, Any]
) -> dict[str, Any]:
    headers = options.get("http_headers")
    header_names: list[str] = []
    if isinstance(headers, dict):
        header_names = sorted(str(key) for key in headers.keys())

    return {
        "url_host": urlparse(video_url).hostname or "unknown",
        "http_header_names": header_names,
    }


def _yt_dlp_extract_worker(
    video_url: str, options: dict[str, Any], result_queue: Any
) -> None:
    """
    子进程执行函数必须保持在模块顶层，Windows spawn 才能稳定导入。
    """
    diagnostics = _build_ytdlp_worker_diagnostics(video_url, options)
    try:
        with YoutubeDL(options) as youtube_dl:
            raw_info = youtube_dl.extract_info(video_url, download=False)
        result_queue.put({"status": "ok", "raw_info": raw_info})
    except (ExtractorError, DownloadError, TimeoutError, OSError) as error:
        result_queue.put(
            {
                "status": "error",
                "error_type": error.__class__.__name__,
                "message": str(error),
                **diagnostics,
            }
        )
    except Exception as error:
        result_queue.put(
            {
                "status": "error",
                "error_type": error.__class__.__name__,
                "message": str(error),
                **diagnostics,
            }
        )


def _apply_cookie_options(options: dict[str, Any]) -> bool:
    if not _is_cookie_debug_enabled():
        return False

    cookie_file = str(os.getenv("YTDLP_COOKIE_FILE") or "").strip()
    cookies_from_browser = str(os.getenv("YTDLP_COOKIES_FROM_BROWSER") or "").strip()
    has_cookie_options = False

    if cookie_file:
        cookie_path = Path(cookie_file).expanduser()
        if cookie_path.exists():
            options["cookiefile"] = str(cookie_path)
            has_cookie_options = True
        else:
            logger.warning("yt-dlp cookie file not found")

    if cookies_from_browser:
        options["cookiesfrombrowser"] = _parse_browser_cookie_spec(cookies_from_browser)
        has_cookie_options = True

    return has_cookie_options


def _without_cookie_options(options: dict[str, Any]) -> dict[str, Any]:
    fallback_options = options.copy()
    fallback_options.pop("cookiefile", None)
    fallback_options.pop("cookiesfrombrowser", None)
    return fallback_options


def _parse_browser_cookie_spec(value: str) -> tuple[str | None, ...]:
    """
    将简化的浏览器 Cookie 配置转成 yt-dlp 接收的 tuple。

    NOTE: 只在 YTDLP_ENABLE_COOKIE_OPTIONS 显式开启时作为开发调试入口。
    """
    spec = value.strip()
    if not spec:
        return ("chrome",)

    browser_part, container = _split_once(spec, "::")
    browser_and_profile, keyring = _split_once(browser_part, "+")
    browser, profile = _split_once(browser_and_profile, ":")
    parts = [browser, profile, keyring, container]
    while parts and parts[-1] is None:
        parts.pop()

    return tuple(parts)


def _split_once(value: str, separator: str) -> tuple[str, str | None]:
    if separator not in value:
        return value, None

    left, right = value.split(separator, 1)
    return left, right or None


def _close_result_queue(result_queue: Any) -> None:
    try:
        result_queue.close()
        result_queue.join_thread()
    except (AttributeError, OSError, ValueError):
        logger.debug("yt-dlp result queue already closed")


def _build_parse_response(video_url: str, raw_info: dict[str, Any]) -> ParseResponse:
    """
    将 yt-dlp 原始输出转换成前端稳定结构。
    """
    transcript = extract_transcript_payload(raw_info)
    has_transcript = any(
        segment.start > 0 or segment.end > 0 for segment in transcript.segments
    )

    return ParseResponse(
        source_url=video_url,
        is_placeholder=False,
        video={
            "video_id": _get_video_id(video_url, raw_info),
            "platform": _get_platform(video_url, raw_info),
            "url": str(raw_info.get("webpage_url") or video_url),
            "title": str(raw_info.get("title") or "未命名媒体内容"),
            "author": str(
                raw_info.get("uploader")
                or raw_info.get("channel")
                or raw_info.get("creator")
                or "未知作者"
            ),
            "duration": _safe_int(raw_info.get("duration")),
            "thumbnail": _get_thumbnail_url(raw_info),
            "has_transcript": has_transcript,
            "media_type": "video",
            "text_source_type": "subtitle",
        },
        formats=_normalize_formats(raw_info.get("formats")),
        format_diagnostics=_build_format_diagnostics(video_url, raw_info),
        transcript=transcript,
        summary=_build_summary_placeholder(has_transcript, raw_info),
        mindmap_markdown="# 元数据解析\n## 已完成\n### 标题\n### 作者\n### 时长\n### 格式列表\n### 内容文本预览\n## 下一步\n### AI 总结",
    )


def _build_format_diagnostics(
    video_url: str,
    raw_info: dict[str, Any],
) -> FormatDiagnostics:
    """
    记录平台本次实际返回的格式上限，用于区分缓存、Cookie 和源视频本身限制。
    """
    raw_formats = raw_info.get("formats")
    if not isinstance(raw_formats, list):
        raw_formats = []

    max_height = _get_raw_max_height(raw_info)
    return FormatDiagnostics(
        raw_format_count=len(raw_formats),
        max_height=max_height or None,
        has_cookie_config=_has_cookie_config(),
        is_bilibili=_is_bilibili_source(video_url, raw_info),
    )


def _has_cookie_config() -> bool:
    return _is_cookie_debug_enabled() and bool(
        str(os.getenv("YTDLP_COOKIE_FILE") or "").strip()
        or str(os.getenv("YTDLP_COOKIES_FROM_BROWSER") or "").strip()
    )


def _is_cookie_debug_enabled() -> bool:
    value = str(os.getenv("YTDLP_ENABLE_COOKIE_OPTIONS") or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _is_bilibili_source(video_url: str, raw_info: dict[str, Any]) -> bool:
    extractor_key = str(raw_info.get("extractor_key") or raw_info.get("extractor") or "")
    hostname = urlparse(video_url).hostname or ""
    return "bilibili" in extractor_key.lower() or _is_bilibili_url(video_url)


def _is_bilibili_url(video_url: str) -> bool:
    hostname = urlparse(video_url).hostname or ""
    return hostname.endswith("bilibili.com") or hostname.endswith("b23.tv")


def _normalize_formats(raw_formats: Any) -> list[dict[str, Any]]:
    """
    过滤并标准化可展示格式，避免把 yt-dlp 的完整 raw 输出暴露给前端。
    """
    if not isinstance(raw_formats, list):
        return []

    normalized_formats: list[dict[str, Any]] = []
    seen_format_ids: set[str] = set()
    seen_display_keys: set[tuple[str, str, str]] = set()
    audio_count = 0

    sorted_formats = sorted(
        [raw_format for raw_format in raw_formats if isinstance(raw_format, dict)],
        key=_get_format_sort_key,
    )

    for raw_format in sorted_formats:
        if not isinstance(raw_format, dict):
            continue

        format_id = str(raw_format.get("format_id") or "").strip()
        extension = str(raw_format.get("ext") or "").strip()
        if not format_id or not extension or format_id in seen_format_ids:
            continue

        seen_format_ids.add(format_id)
        resolution = _get_resolution_label(raw_format)
        vcodec = str(raw_format.get("vcodec") or "unknown")
        acodec = str(raw_format.get("acodec") or "unknown")
        filesize = _get_filesize(raw_format)
        media_kind = _get_media_kind(vcodec, acodec)
        display_key = _get_display_format_key(media_kind, resolution, extension)
        if display_key in seen_display_keys:
            continue

        if media_kind == "audio" and audio_count >= MAX_AUDIO_FORMATS:
            continue

        seen_display_keys.add(display_key)
        normalized_formats.append(
            {
                "format_id": format_id,
                "ext": extension,
                "resolution": resolution,
                "vcodec": vcodec,
                "acodec": acodec,
                "filesize": filesize,
                "label": _build_format_label(resolution, extension, media_kind),
            }
        )
        if media_kind == "audio":
            audio_count += 1

        if len(normalized_formats) >= MAX_FORMATS:
            break

    return normalized_formats


def _get_display_format_key(
    media_kind: str,
    resolution: str,
    extension: str,
) -> tuple[str, str, str]:
    """
    同一清晰度可能有多条不同编码/码率的流，面向 MVP 只保留排序后的最优展示候选。
    """
    return (media_kind, resolution, extension.lower())


def _get_format_sort_key(raw_format: dict[str, Any]) -> tuple[int, int, int, int]:
    vcodec = str(raw_format.get("vcodec") or "unknown")
    acodec = str(raw_format.get("acodec") or "unknown")
    media_kind = _get_media_kind(vcodec, acodec)
    height = _safe_int(raw_format.get("height"))
    bitrate = _safe_int(raw_format.get("tbr") or raw_format.get("abr"))
    media_rank = {"video": 0, "video_only": 0, "audio": 1, "unknown": 2}
    merge_penalty = 0 if media_kind == "video" else 1

    # NOTE: yt-dlp 原始 formats 通常从低清或音频开始，先排序才能把 1080p 等高分辨率候选展示出来。
    return (media_rank.get(media_kind, 2), -height, merge_penalty, -bitrate)


def _get_media_kind(vcodec: str, acodec: str) -> str:
    has_video = vcodec != "none"
    has_audio = acodec != "none"
    if has_video and has_audio:
        return "video"

    if has_video:
        return "video_only"

    if has_audio:
        return "audio"

    return "unknown"


def _build_format_label(resolution: str, extension: str, media_kind: str) -> str:
    if media_kind == "video":
        return f"{resolution} {extension.upper()} · 音视频"

    if media_kind == "video_only":
        return f"{resolution} {extension.upper()} · 仅视频"

    if media_kind == "audio":
        return f"音频 {extension.upper()}"

    return f"{resolution} {extension.upper()}"


def _get_resolution_label(raw_format: dict[str, Any]) -> str:
    height = _safe_int(raw_format.get("height"))
    if height > 0:
        return f"{height}p"

    resolution = raw_format.get("resolution")
    if isinstance(resolution, str) and resolution and resolution != "audio only":
        return resolution

    vcodec = str(raw_format.get("vcodec") or "")
    if vcodec == "none":
        return "audio"

    return "unknown"


def _get_filesize(raw_format: dict[str, Any]) -> int | None:
    filesize = raw_format.get("filesize") or raw_format.get("filesize_approx")
    parsed_filesize = _safe_int(filesize)
    return parsed_filesize if parsed_filesize > 0 else None


def _get_thumbnail_url(raw_info: dict[str, Any]) -> str:
    thumbnail = str(raw_info.get("thumbnail") or "").strip()
    if not thumbnail:
        return PLACEHOLDER_THUMBNAIL

    if thumbnail.startswith("//"):
        return f"https:{thumbnail}"

    return thumbnail


def _build_summary_placeholder(
    has_transcript: bool, raw_info: dict[str, Any]
) -> dict[str, Any]:
    transcript_status = "已生成内容文本预览" if has_transcript else "暂未生成可用内容文本预览"
    if raw_info.get("_metadata_source") == BILIBILI_PUBLIC_METADATA_SOURCE:
        metadata_status = "已通过 B 站公开接口获取标题、作者、时长和封面。"
    else:
        metadata_status = "已通过 yt-dlp 获取媒体标题、作者、时长和格式列表。"

    return {
        "tldr": "已完成真实媒体元数据解析；如有可用内容文本，可点击右侧生成 AI 总结。",
        "key_points": [
            metadata_status,
            f"{transcript_status}，当前支持 VTT/SRT 字幕解析。",
            "解析阶段只整理媒体信息和内容文本；总结和下载由后续操作触发。",
        ],
        "timeline": [],
        "structured_analysis_markdown": (
            "## 当前阶段\n"
            "### 已完成\n"
            "真实 URL 元数据解析、格式标准化和内容文本预览。\n"
            "### 可继续\n"
            "存在可用内容文本时，可在 AI 总结页点击生成结构化总结。\n"
        ),
        "takeaways": [
            "优先使用带字幕或逐字稿的媒体内容生成 AI 总结。",
            "如果平台暂时无法返回内容文本，可以换链接或稍后重试。",
        ],
    }


def _get_video_id(video_url: str, raw_info: dict[str, Any]) -> str:
    raw_id = raw_info.get("id")
    if isinstance(raw_id, str) and raw_id.strip():
        return raw_id.strip()

    digest = hashlib.sha256(video_url.encode("utf-8")).hexdigest()[:12]
    return f"video_{digest}"


def _get_platform(video_url: str, raw_info: dict[str, Any]) -> str:
    extractor_key = raw_info.get("extractor_key") or raw_info.get("extractor")
    if isinstance(extractor_key, str) and extractor_key.strip():
        return extractor_key.strip().lower()

    hostname = urlparse(video_url).hostname
    return hostname or "unknown"


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _build_parse_error(error_code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"success": False, "error_code": error_code, "message": message},
    )


def _build_download_error(
    error_code: str,
    message: str,
    status_code: int = 400,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"success": False, "error_code": error_code, "message": message},
    )
