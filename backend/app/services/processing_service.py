"""批处理和兼容 API 共用的媒体处理阶段。"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException

from app.schemas import (
    ParseResponse,
    SummarizeRequest,
    SummarizeResponse,
    TranscribeResponse,
)
from app.services.asr_service import AudioDownloaderFactory
from app.services.bilibili_service import (
    is_bilibili_url,
    resolve_bilibili_transcription_source,
)
from app.services.douyin_service import (
    create_douyin_transcription_downloader,
    is_douyin_url,
)
from app.services.library_service import (
    get_library_detail,
    get_library_detail_by_source_url,
    update_summary_for_source_url,
    update_transcript_for_source_url,
    upsert_library_item,
)
from app.services.media_source_service import parse_media_source
from app.services.summarize_service import summarize_transcript
from app.services.xiaohongshu_service import is_xiaohongshu_url


def merge_refreshed_xiaohongshu_detail(
    cached_detail: ParseResponse,
    refreshed_detail: ParseResponse,
) -> ParseResponse:
    """刷新平台元数据时保留用户已经生成的转写、总结和摘录。"""
    refreshed_author = refreshed_detail.video.author.strip()
    keep_cached_author = refreshed_author.lower() in {
        "",
        "unknown",
        "未知",
        "未知作者",
    }
    page_metadata_refreshed = bool(refreshed_detail.transcription_source_url)
    merged_video = refreshed_detail.video.model_copy(
        update={
            "author": (
                cached_detail.video.author
                if keep_cached_author
                else refreshed_detail.video.author
            ),
            "has_transcript": cached_detail.video.has_transcript,
            "media_type": (
                cached_detail.video.media_type or refreshed_detail.video.media_type
            ),
            "text_source_type": (
                cached_detail.video.text_source_type
                if cached_detail.video.has_transcript
                else refreshed_detail.video.text_source_type
            ),
            # 页面补取失败时 yt-dlp 可能再次给出 WB_PRV，不能覆盖已有封面。
            "thumbnail": (
                refreshed_detail.video.thumbnail
                if page_metadata_refreshed
                else cached_detail.video.thumbnail
            ),
        }
    )
    return refreshed_detail.model_copy(
        update={
            "video": merged_video,
            "transcript": cached_detail.transcript,
            "transcript_variants": cached_detail.transcript_variants,
            "active_transcript_variant": cached_detail.active_transcript_variant,
            "summary": cached_detail.summary,
            "mindmap_markdown": cached_detail.mindmap_markdown,
            "mindmap_meta": cached_detail.mindmap_meta,
            "note_draft": cached_detail.note_draft,
            "is_placeholder": cached_detail.is_placeholder,
            "library_summary_status": cached_detail.library_summary_status,
            "library_summary_model": cached_detail.library_summary_model,
        }
    )


def parse_and_persist(source_url: str) -> ParseResponse:
    cached = get_library_detail_by_source_url(source_url)
    if cached is not None and not is_xiaohongshu_url(source_url):
        return cached
    detail = parse_media_source(source_url)
    if cached is not None:
        detail = merge_refreshed_xiaohongshu_detail(cached, detail)
    upsert_library_item(detail)
    persisted = get_library_detail_by_source_url(detail.source_url)
    if persisted is None:
        persisted = get_library_detail(detail.video.video_id)
    if persisted is None:
        raise RuntimeError("解析结果未能写入本地内容库")
    return persisted


def has_full_transcript(detail: ParseResponse) -> bool:
    return bool(
        detail.transcript.plain_text.strip()
        and (detail.video.text_source_type or "").strip().lower() != "shownotes"
    )


def has_complete_summary(detail: ParseResponse) -> bool:
    return bool(
        detail.summary.tldr.strip()
        and detail.library_summary_status in {"ai_generated", "local_fallback"}
    )


def resolve_transcription_media(
    source_url: str, *, allow_source_fallback: bool = False
) -> tuple[str, dict[str, str] | None, AudioDownloaderFactory | None]:
    """解析实际转写媒体地址及平台专用下载器。"""
    transcription_url = source_url
    headers = None
    factory = None
    if is_bilibili_url(source_url):
        resolved = resolve_bilibili_transcription_source(source_url)
        transcription_url, headers = resolved.audio_url, resolved.http_headers
    elif is_douyin_url(source_url):
        factory = create_douyin_transcription_downloader
    else:
        hostname = urlparse(source_url).hostname or ""
        if hostname.endswith("xiaoyuzhoufm.com") or is_xiaohongshu_url(source_url):
            try:
                refreshed = parse_media_source(source_url)
            except HTTPException:
                # 兼容转写接口允许原链接兜底；持久任务保留失败阶段供重试。
                if not allow_source_fallback:
                    raise
            else:
                transcription_url = refreshed.transcription_source_url or source_url
    return transcription_url, headers, factory


def persist_transcription(detail: ParseResponse, response: TranscribeResponse) -> ParseResponse:
    update_transcript_for_source_url(
        detail.source_url,
        response.transcript,
        response.transcript_variant_key,
        response.shownotes_context,
    )
    persisted = get_library_detail_by_source_url(detail.source_url)
    if persisted is None or not has_full_transcript(persisted):
        raise RuntimeError("转写稿未能写入本地内容库")
    return persisted


def summarize_and_persist(detail: ParseResponse) -> tuple[ParseResponse, SummarizeResponse]:
    if not has_full_transcript(detail):
        raise HTTPException(status_code=400, detail="缺少完整逐字稿")
    request = SummarizeRequest(
        transcript_plain_text=detail.transcript.plain_text,
        transcript_segments=detail.transcript.segments,
        source_url=detail.source_url,
        video_title=detail.video.title,
        video_author=detail.video.author,
        media_type=detail.video.media_type,
        text_source_type=detail.video.text_source_type,
        shownotes_plain_text=detail.shownotes_plain_text,
        shownotes_context=detail.shownotes_context,
    )
    response = summarize_transcript(request)
    update_summary_for_source_url(detail.source_url, response)
    persisted = get_library_detail_by_source_url(detail.source_url)
    if persisted is None or not has_complete_summary(persisted):
        raise RuntimeError("总结未能写入本地内容库")
    return persisted, response


def task_identity(detail: ParseResponse) -> dict[str, Any]:
    content_key = f"{detail.video.platform}:{detail.video.video_id}"
    if detail.video.platform.lower() in {"bilibili", "b站"}:
        part = parse_qs(urlparse(detail.source_url).query).get("p", [""])[0]
        if part:
            content_key = f"{content_key}:p={part}"
    return {
        "video_id": detail.video.video_id,
        "content_key": content_key,
        "title": detail.video.title,
        "author": detail.video.author,
        "platform": detail.video.platform,
        "thumbnail": detail.video.thumbnail,
    }
