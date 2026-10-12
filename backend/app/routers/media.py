"""公开媒体解析与下载接口。"""

import logging
import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.schemas import DownloadRequest, DownloadResponse, ParseRequest, ParseResponse
from app.services.bilibili_service import (
    download_bilibili_video_format,
    is_bilibili_url,
)
from app.services.douyin_service import download_douyin_video, is_douyin_url
from app.services.library_service import (
    get_library_detail_by_source_url,
    upsert_library_item,
)
from app.services.media_source_service import parse_media_source
from app.services.processing_resources import DOWNLOAD_SLOTS
from app.services.processing_service import merge_refreshed_xiaohongshu_detail
from app.services.url_normalization_service import normalize_public_video_url
from app.services.xiaohongshu_service import is_xiaohongshu_url
from app.services.ytdlp_service import download_video_format


router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/parse", response_model=ParseResponse)
def parse_video(request: Request, parse_request: ParseRequest) -> ParseResponse:
    """
    校验真实解析入口，并返回媒体元数据解析结果。
    """
    video_url = normalize_public_video_url(parse_request.url)
    try:
        cached_detail = get_library_detail_by_source_url(video_url)
    except (sqlite3.Error, OSError, ValueError) as error:
        cached_detail = None
        logger.warning("library cache lookup failed: %s", error.__class__.__name__)

    if cached_detail is not None and not is_xiaohongshu_url(video_url):
        return cached_detail

    parse_response = parse_media_source(video_url)
    if cached_detail is not None:
        parse_response = merge_refreshed_xiaohongshu_detail(
            cached_detail,
            parse_response,
        )
    try:
        upsert_library_item(parse_response)
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning("library upsert failed: %s", error.__class__.__name__)
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error_code": "LIBRARY_SAVE_FAILED",
                "message": "解析成功，但结果写入本地档案失败，请稍后重试。",
            },
        ) from error

    return parse_response


def _remove_completed_download(file_path: Path) -> None:
    """浏览器接收完文件后删除后端生成的临时下载文件。"""
    try:
        file_path.unlink(missing_ok=True)
    except OSError as error:
        logger.warning(
            "failed to remove completed browser download: %s",
            error.__class__.__name__,
        )


def _prepare_video_download(download_request: DownloadRequest) -> DownloadResponse:
    """复用各平台下载实现，返回后端已准备好的文件信息。"""
    video_url = normalize_public_video_url(download_request.url)
    with DOWNLOAD_SLOTS:
        if is_bilibili_url(video_url):
            return download_bilibili_video_format(
                source_url=video_url,
                format_id=download_request.format_id,
                merge_with_audio=download_request.merge_with_audio,
            )

        if is_douyin_url(video_url):
            return download_douyin_video(video_url)

        return download_video_format(
            video_url=video_url,
            format_id=download_request.format_id,
            merge_with_audio=download_request.merge_with_audio,
        )


@router.post("/api/download", response_model=DownloadResponse)
def download_video_legacy(download_request: DownloadRequest) -> DownloadResponse:
    """保留旧 JSON 协议，避免已打开页面把媒体二进制误当作 JSON。"""
    return _prepare_video_download(download_request)


@router.post("/api/download/file", response_class=FileResponse)
def download_video_file(download_request: DownloadRequest) -> FileResponse:
    """
    准备用户选择的公开视频格式，并作为浏览器附件下载返回。
    """
    download_result = _prepare_video_download(download_request)
    download_path = Path(download_result.file_path)
    return FileResponse(
        path=download_path,
        filename=download_result.filename,
        media_type="application/octet-stream",
        background=BackgroundTask(_remove_completed_download, download_path),
    )
