import http.client
import json
import logging
import os
import re
import shutil
import ssl
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urljoin, urlparse

from fastapi import HTTPException

from app.schemas import DownloadResponse, ParseResponse
from app.services.douyin_adapter import (
    DouyinMediaInfo,
    build_media_info,
    extract_page_item,
    extract_video_id,
    solve_challenge_cookie,
    supports_douyin_url,
)
from app.services.http_fetch_service import DEFAULT_USER_AGENT, validate_public_http_url
from app.services.ytdlp_service import PLACEHOLDER_THUMBNAIL

logger = logging.getLogger(__name__)

DOUYIN_FORMAT_ID = "douyin_nowatermark"
DOUYIN_TIMEOUT_SECONDS = 15
DOUYIN_MAX_REDIRECTS = 5
DOUYIN_PAGE_MAX_BYTES = 8 * 1024 * 1024
DOUYIN_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024
DOUYIN_BROWSER_TIMEOUT_SECONDS = 30
DOUYIN_BROWSER_DOWNLOAD_TIMEOUT_SECONDS = 10 * 60
DOUYIN_BROWSER_MAX_ATTEMPTS = 3
DOUYIN_BROWSER_RETRY_DELAYS_SECONDS = (2, 5)
DOWNLOAD_TEMP_SUFFIX = ".part"
DOUYIN_BROWSER_SCRIPT = (
    Path(__file__).resolve().parents[3] / "scripts" / "extract-douyin-media.mjs"
)
MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
    "Mobile/15E148 Safari/604.1"
)


def is_douyin_url(source_url: str) -> bool:
    """判断链接是否属于抖音公开页面。"""
    return supports_douyin_url(source_url)


def get_douyin_thumbnail_url(source_url: str) -> str:
    """从抖音公开页面刷新当前可用的媒体封面地址。"""
    media = _extract_douyin_video(source_url)
    return (media.thumbnail_url or "").strip()


def parse_douyin_video(source_url: str) -> ParseResponse:
    """读取抖音公开分享页并转换为项目统一的解析结果。"""
    media = _extract_douyin_video(source_url)
    resolution = f"{media.height}p" if media.height > 0 else "unknown"

    return ParseResponse(
        source_url=source_url,
        is_placeholder=False,
        video={
            "video_id": f"douyin_{media.video_id}",
            "platform": "douyin",
            "url": media.source_url,
            "title": media.title,
            "author": media.author,
            "duration": media.duration_seconds,
            "thumbnail": media.thumbnail_url or PLACEHOLDER_THUMBNAIL,
            "has_transcript": False,
            "media_type": "video",
            "text_source_type": "content",
        },
        formats=[
            {
                "format_id": DOUYIN_FORMAT_ID,
                "ext": "mp4",
                "resolution": resolution,
                "vcodec": "unknown",
                "acodec": "unknown",
                "filesize": media.file_size,
                "label": f"{resolution} MP4 · 无水印直链",
            }
        ],
        transcript={"segments": [], "plain_text": ""},
        summary=_build_summary_placeholder(),
        mindmap_markdown=(
            "# 抖音解析\n## 已完成\n### 标题\n### 作者\n### 无水印视频直链\n"
            "## 下一步\n### 下载保存"
        ),
        transcription_source_url=media.video_url,
    )


def download_douyin_video(source_url: str) -> DownloadResponse:
    """将公开可访问的视频文件下载到用户配置的本地目录。"""
    media = _extract_douyin_video(source_url)
    download_dir = _get_download_dir()
    target_path = download_dir / _build_download_filename(media)
    temporary_path = target_path.with_suffix(f"{target_path.suffix}{DOWNLOAD_TEMP_SUFFIX}")

    try:
        DouyinPublicClient().download_browser_media(source_url, temporary_path)
        temporary_path.replace(target_path)
    except OSError as error:
        logger.warning("douyin download failed: %s", error.__class__.__name__)
        temporary_path.unlink(missing_ok=True)
        raise _douyin_error(
            "DOUYIN_DOWNLOAD_FAILED",
            "抖音视频下载失败，请稍后重试或换一个公开视频链接。",
        ) from error

    return DownloadResponse(
        filename=target_path.name,
        file_path=str(target_path),
        format_selector=DOUYIN_FORMAT_ID,
        message="下载已保存到本地目录。",
    )


def create_douyin_transcription_downloader(
    output_dir: Path,
) -> Callable[[str], Path]:
    """创建在 ASR 临时目录内保存抖音媒体文件的下载器。"""
    target_path = output_dir / "douyin-transcribe.mp4"

    def download(source_url: str) -> Path:
        try:
            DouyinPublicClient().download_browser_media(source_url, target_path)
        except OSError as error:
            logger.warning(
                "douyin browser audio download failed: %s",
                error.__class__.__name__,
            )
            message = (
                "音频下载失败：抖音暂时没有返回播放详情，已自动重试，请稍后再试。"
                if "request failed after retries" in str(error)
                else "音频下载失败：平台没有返回可用于转写的媒体流，请稍后重试或更换公开视频链接。"
            )
            raise _douyin_error(
                "DOUYIN_AUDIO_DOWNLOAD_FAILED",
                message,
            ) from error
        return target_path

    return download


def _extract_douyin_video(source_url: str) -> DouyinMediaInfo:
    client = DouyinPublicClient()
    try:
        resolved_url = client.resolve(source_url)
        try:
            browser_item = client.read_browser_item(resolved_url)
        except OSError as error:
            browser_item = None
            logger.warning(
                "douyin browser primary parser failed: %s",
                error.__class__.__name__,
            )

        browser_video_id = _get_douyin_item_id(browser_item)
        if browser_item is not None and browser_video_id is not None:
            return _build_douyin_media_info(
                browser_item,
                video_id=browser_video_id,
                source_url=source_url,
                resolved_url=resolved_url,
            )

        # 仅兼容少数仍在静态页面中内嵌旧数据的历史链接；正常解析不依赖此分支。
        video_id = extract_video_id(resolved_url)
        page_url = _choose_page_url(resolved_url, video_id)
        page_text = client.read_text(page_url, mobile=True)

        if video_id is None:
            video_id = extract_video_id(resolved_url, page_text)
            if video_id is not None:
                # “听视频”等页面只负责暴露原视频 ID，后续仍交给现有标准视频页解析链路。
                page_url = f"https://www.iesdouyin.com/share/video/{video_id}/"
                page_text = client.read_text(page_url, mobile=True)
        if video_id is None:
            raise _douyin_error(
                "DOUYIN_VIDEO_ID_NOT_FOUND",
                "未能识别抖音视频 ID，请确认链接来自公开抖音视频分享页。",
            )

        challenge_cookie = solve_challenge_cookie(page_text)
        if challenge_cookie:
            page_text = client.read_text(
                page_url,
                mobile=True,
                transient_cookie=challenge_cookie,
            )

        item = extract_page_item(page_text, video_id)
        if item is None:
            raise _douyin_error(
                "DOUYIN_PAGE_PARSE_FAILED",
                "抖音页面解析失败，请稍后重试或换一个公开视频链接。",
            )
        return _build_douyin_media_info(
            item,
            video_id=video_id,
            source_url=source_url,
            resolved_url=resolved_url,
        )
    except HTTPException:
        raise
    except OSError as error:
        logger.warning("douyin public page request failed: %s", error.__class__.__name__)
        raise _douyin_error(
            "DOUYIN_PAGE_FETCH_FAILED",
            "抖音公开页面读取失败，请稍后重试。",
        ) from error


class DouyinPublicClient:
    """只访问公开 HTTP 资源，不读取浏览器 Cookie 或登录状态。"""

    def resolve(self, source_url: str) -> str:
        current_url = source_url.strip()
        for _ in range(DOUYIN_MAX_REDIRECTS + 1):
            status, headers, _ = self._request(
                current_url,
                max_bytes=DOUYIN_PAGE_MAX_BYTES,
                mobile=False,
            )
            location = headers.get("location")
            if status not in {301, 302, 303, 307, 308} or not location:
                return current_url
            current_url = urljoin(current_url, location)

        raise OSError("douyin link redirected too many times")

    def read_text(
        self,
        source_url: str,
        *,
        mobile: bool,
        transient_cookie: str | None = None,
    ) -> str:
        current_url = source_url
        for _ in range(DOUYIN_MAX_REDIRECTS + 1):
            status, headers, body = self._request(
                current_url,
                max_bytes=DOUYIN_PAGE_MAX_BYTES,
                mobile=mobile,
                transient_cookie=transient_cookie,
            )
            location = headers.get("location")
            if status in {301, 302, 303, 307, 308} and location:
                current_url = urljoin(current_url, location)
                continue
            if status >= 400:
                raise OSError(f"douyin page returned status={status}")

            charset = _read_charset(headers.get("content-type", ""))
            return body.decode(charset, errors="replace")

        raise OSError("douyin page redirected too many times")

    def download(self, source_url: str, target_path: Path) -> None:
        current_url = source_url
        for _ in range(DOUYIN_MAX_REDIRECTS + 1):
            parsed_url = _validated_url(current_url)
            connection = _open_connection(parsed_url)
            try:
                connection.request("GET", _request_path(parsed_url), headers=_headers(False))
                response = connection.getresponse()
                location = response.getheader("Location")
                if response.status in {301, 302, 303, 307, 308} and location:
                    response.read()
                    current_url = urljoin(current_url, location)
                    continue
                if response.status >= 400:
                    raise OSError(f"douyin file returned status={response.status}")

                written_bytes = 0
                with target_path.open("wb") as output_file:
                    while chunk := response.read(1024 * 256):
                        written_bytes += len(chunk)
                        if written_bytes > DOUYIN_DOWNLOAD_MAX_BYTES:
                            raise OSError("douyin file is too large")
                        output_file.write(chunk)
                return
            finally:
                connection.close()

        raise OSError("douyin file redirected too many times")

    def read_browser_item(self, source_url: str) -> dict[str, object] | None:
        """通过临时匿名浏览器读取抖音当前公开详情接口的响应。"""
        result = self._run_browser_helper(
            [source_url],
            timeout_seconds=DOUYIN_BROWSER_TIMEOUT_SECONDS,
        )
        if len(result.stdout.encode("utf-8")) > DOUYIN_PAGE_MAX_BYTES:
            raise OSError("douyin browser fallback payload is too large")

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise OSError("douyin browser fallback returned invalid JSON") from error

        return payload if isinstance(payload, dict) else None

    def download_browser_media(self, source_url: str, target_path: Path) -> None:
        """在匿名 Edge 会话中取得媒体流，避免脱离页面上下文后被平台拒绝。"""
        self._run_browser_helper(
            ["--download-media", str(target_path), source_url],
            timeout_seconds=DOUYIN_BROWSER_DOWNLOAD_TIMEOUT_SECONDS,
            failed_target_path=target_path,
        )
        if not target_path.is_file():
            raise OSError("douyin browser media request returned no file")
        if target_path.stat().st_size > DOUYIN_DOWNLOAD_MAX_BYTES:
            target_path.unlink(missing_ok=True)
            raise OSError("douyin browser media file is too large")

    def _run_browser_helper(
        self,
        arguments: list[str],
        *,
        timeout_seconds: int,
        failed_target_path: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """在独立匿名 Edge 会话中重试短暂缺失的抖音详情请求。"""
        node_executable = shutil.which("node") or shutil.which("node.exe")
        if not node_executable:
            raise OSError("node executable not found")
        if not DOUYIN_BROWSER_SCRIPT.exists():
            raise OSError("douyin browser helper not found")

        for attempt in range(DOUYIN_BROWSER_MAX_ATTEMPTS):
            try:
                result = subprocess.run(
                    [node_executable, str(DOUYIN_BROWSER_SCRIPT), *arguments],
                    capture_output=True,
                    check=False,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout_seconds,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                result = None
                failure_reason = error.__class__.__name__
            else:
                if result.returncode == 0:
                    return result
                failure_reason = _read_browser_failure_reason(result.stderr)

            if failed_target_path is not None:
                failed_target_path.unlink(missing_ok=True)
            if attempt == DOUYIN_BROWSER_MAX_ATTEMPTS - 1:
                raise OSError(
                    "douyin browser request failed after retries: "
                    f"{failure_reason}"
                )

            delay_seconds = DOUYIN_BROWSER_RETRY_DELAYS_SECONDS[attempt]
            logger.warning(
                "douyin browser request failed; retry=%s/%s reason=%s",
                attempt + 1,
                DOUYIN_BROWSER_MAX_ATTEMPTS,
                failure_reason,
            )
            time.sleep(delay_seconds)

    def _request(
        self,
        source_url: str,
        *,
        max_bytes: int,
        mobile: bool,
        transient_cookie: str | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        parsed_url = _validated_url(source_url)
        connection = _open_connection(parsed_url)
        try:
            connection.request(
                "GET",
                _request_path(parsed_url),
                headers=_headers(mobile, transient_cookie),
            )
            response = connection.getresponse()
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise OSError("douyin resource is too large")
            headers = {key.lower(): value for key, value in response.getheaders()}
            return response.status, headers, body
        finally:
            connection.close()


def _read_browser_failure_reason(stderr: str) -> str:
    """压缩浏览器脚本错误，供服务端日志区分超时与媒体流拒绝。"""
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    return lines[-1] if lines else "unknown"


def _choose_page_url(resolved_url: str, video_id: str | None) -> str:
    hostname = (urlparse(resolved_url).hostname or "").lower()
    if hostname == "iesdouyin.com" or hostname.endswith(".iesdouyin.com"):
        return resolved_url
    if video_id:
        return f"https://www.iesdouyin.com/share/video/{video_id}/"
    return resolved_url


def _get_douyin_item_id(item: dict[str, object] | None) -> str | None:
    if item is None:
        return None

    candidate = item.get("aweme_id") or item.get("awemeId") or item.get("id")
    candidate_text = str(candidate or "")
    return candidate_text if candidate_text.isdigit() else None


def _build_douyin_media_info(
    item: dict[str, object],
    *,
    video_id: str,
    source_url: str,
    resolved_url: str,
) -> DouyinMediaInfo:
    try:
        return build_media_info(
            item,
            video_id=video_id,
            source_url=source_url,
            resolved_url=resolved_url,
        )
    except ValueError as error:
        raise _douyin_error(
            "DOUYIN_VIDEO_URL_NOT_FOUND",
            "未找到抖音视频直链。",
        ) from error


def _validated_url(source_url: str):
    parsed_url = urlparse(source_url)
    validate_public_http_url(parsed_url.hostname, parsed_url.scheme)
    return parsed_url


def _request_path(parsed_url) -> str:
    path = parsed_url.path or "/"
    return f"{path}?{parsed_url.query}" if parsed_url.query else path


def _open_connection(parsed_url) -> http.client.HTTPConnection:
    if parsed_url.scheme == "https":
        return http.client.HTTPSConnection(
            parsed_url.hostname,
            parsed_url.port,
            timeout=DOUYIN_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        )
    return http.client.HTTPConnection(
        parsed_url.hostname,
        parsed_url.port,
        timeout=DOUYIN_TIMEOUT_SECONDS,
    )


def _headers(mobile: bool, transient_cookie: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json,text/html,*/*",
        "Accept-Encoding": "identity",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Connection": "close",
        "Referer": "https://www.douyin.com/",
        "User-Agent": MOBILE_USER_AGENT if mobile else DEFAULT_USER_AGENT,
    }
    if transient_cookie:
        headers["Cookie"] = transient_cookie
    return headers


def _read_charset(content_type: str) -> str:
    charset_match = re.search(r"charset=([^;\s]+)", content_type, flags=re.IGNORECASE)
    return charset_match.group(1).strip('"\'') if charset_match else "utf-8"


def _get_download_dir() -> Path:
    configured_dir = os.getenv("YTDLP_DOWNLOAD_DIR", "").strip()
    download_dir = (
        Path(configured_dir).expanduser()
        if configured_dir
        else Path(__file__).resolve().parents[2] / "data" / "downloads"
    )
    download_dir.mkdir(parents=True, exist_ok=True)
    return download_dir.resolve()


def _build_download_filename(media: DouyinMediaInfo) -> str:
    safe_title = _sanitize_filename(media.title or "douyin-video")[:80]
    safe_video_id = _sanitize_filename(media.video_id)
    return f"{safe_title} [{safe_video_id}] {int(time.time())}.mp4"


def _sanitize_filename(value: str) -> str:
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    return sanitized or "douyin-video"


def _build_summary_placeholder() -> dict[str, object]:
    return {
        "tldr": "已完成抖音公开视频解析，可下载当前公开可访问的视频文件。",
        "key_points": [
            "已通过抖音专用适配器识别公开视频信息。",
            "当前没有可用平台字幕，可后续手动生成 AI 转写稿。",
            "下载能力只处理公开可访问资源，不处理付费、私密或受限内容。",
        ],
        "timeline": [],
        "structured_analysis_markdown": (
            "## 当前阶段\n### 已完成\n抖音元数据解析和无水印视频直链提取。\n"
            "### 可继续\n下载保存到本地目录。\n"
        ),
        "takeaways": [
            "抖音解析使用专用适配器，不依赖通用 yt-dlp 兜底。",
            "平台页面变动时可能需要更新适配器。",
        ],
    }


def _douyin_error(error_code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"success": False, "error_code": error_code, "message": message},
    )
