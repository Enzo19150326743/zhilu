"""总结、问答和兼容转写接口。"""

import logging
import sqlite3

from fastapi import APIRouter, HTTPException, Request

from app.schemas import (
    QaRequest,
    QaResponse,
    SummarizeRequest,
    SummarizeResponse,
    TranscribeRequest,
    TranscribeResponse,
)
from app.services.asr_service import transcribe_media_audio
from app.services.correction_term_service import CorrectionTermError, record_term_usage
from app.services.deepseek_client import DeepSeekOutputTruncatedError
from app.services.library_service import (
    get_library_detail_by_source_url,
    update_summary_for_source_url,
    update_transcript_for_source_url,
)
from app.services.processing_resources import AI_WORK_SLOTS, RECOGNITION_SLOT
from app.services.processing_service import resolve_transcription_media
from app.services.qa_service import answer_question
from app.services.summarize_service import summarize_transcript
from app.services.url_normalization_service import normalize_public_video_url


router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/summarize", response_model=SummarizeResponse)
def summarize_video(
    request: Request,
    summarize_request: SummarizeRequest,
) -> SummarizeResponse:
    """
    基于现有内容文本生成结构化总结。
    """
    if not summarize_request.transcript_plain_text.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "TRANSCRIPT_EMPTY",
                "message": "没有可用于总结的内容文本。",
            },
        )

    if (summarize_request.text_source_type or "").strip().lower() == "shownotes":
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "FULL_TRANSCRIPT_REQUIRED",
                "message": "当前只有 shownotes 原文，请先生成完整逐字稿，再生成总结和导图。",
            },
        )

    summarize_request = _hydrate_summarize_request_from_library(summarize_request)
    try:
        with AI_WORK_SLOTS:
            summarize_response = summarize_transcript(summarize_request)
    except DeepSeekOutputTruncatedError as error:
        logger.warning("AI summary output truncated")
        raise HTTPException(
            status_code=502,
            detail={
                "success": False,
                "error_code": "AI_OUTPUT_TRUNCATED",
                "message": (
                    "AI 输出达到长度限制，结果未完整生成。"
                    "请稍后重试，或提高对应的最大输出长度后再试。"
                ),
            },
        ) from error
    try:
        saved = update_summary_for_source_url(
            summarize_request.source_url,
            summarize_response,
        )
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "library summary update failed: %s",
            error.__class__.__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error_code": "SUMMARY_SAVE_FAILED",
                "message": "总结已生成，但写入本地档案失败，请稍后重试。",
            },
        ) from error
    if summarize_request.source_url and not saved:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "error_code": "LIBRARY_ITEM_NOT_FOUND",
                "message": "总结已生成，但没有找到对应的本地档案。",
            },
        )

    return summarize_response


@router.post("/api/qa", response_model=QaResponse)
def answer_media_question(request: Request, qa_request: QaRequest) -> QaResponse:
    """
    基于当前内容文本回答用户问题。
    """
    if not qa_request.question.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "QUESTION_EMPTY",
                "message": "请输入要询问的问题。",
            },
        )

    if not qa_request.transcript_plain_text.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "TRANSCRIPT_EMPTY",
                "message": "没有可用于问答的内容文本。",
            },
        )

    if (qa_request.text_source_type or "").strip().lower() == "shownotes":
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "FULL_TRANSCRIPT_REQUIRED",
                "message": "当前只有 shownotes 原文，请先生成完整逐字稿，再进行内容问答。",
            },
        )

    try:
        return answer_question(qa_request)
    except DeepSeekOutputTruncatedError as error:
        logger.warning("AI qa output truncated")
        raise HTTPException(
            status_code=502,
            detail={
                "success": False,
                "error_code": "AI_OUTPUT_TRUNCATED",
                "message": (
                    "AI 输出达到长度限制，结果未完整生成。"
                    "请稍后重试，或提高对应的最大输出长度后再试。"
                ),
            },
        ) from error


@router.post("/api/transcribe", response_model=TranscribeResponse)
def transcribe_video(
    request: Request,
    transcribe_request: TranscribeRequest,
) -> TranscribeResponse:
    """
    当平台没有现成文字时，按用户选择使用本地 ASR 生成转写稿。
    """
    video_url = normalize_public_video_url(transcribe_request.url)
    transcribe_context = _get_transcribe_prompt_context(video_url)
    transcribe_source_url, transcribe_http_headers, downloader_factory = resolve_transcription_media(
        video_url, allow_source_fallback=True
    )
    with RECOGNITION_SLOT:
        transcribe_response = transcribe_media_audio(
            video_url=transcribe_source_url,
            video_id=transcribe_request.video_id,
            http_headers=transcribe_http_headers,
            audio_downloader_factory=downloader_factory,
            response_source_url=video_url,
            media_title=transcribe_context.get("title"),
            media_author=transcribe_context.get("author"),
            media_platform=transcribe_context.get("platform"),
            media_type=transcribe_context.get("media_type"),
            context_settings=transcribe_request.context_settings,
            shownotes_plain_text=transcribe_context.get("shownotes_plain_text"),
        )
    try:
        saved = update_transcript_for_source_url(
            video_url,
            transcribe_response.transcript,
            transcribe_response.transcript_variant_key,
            transcribe_response.shownotes_context,
        )
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "library transcript update failed: %s",
            error.__class__.__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error_code": "TRANSCRIPT_SAVE_FAILED",
                "message": "转写已完成，但写入本地档案失败，请稍后重试。",
            },
        ) from error
    if not saved:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "error_code": "LIBRARY_ITEM_NOT_FOUND",
                "message": "转写已完成，但没有找到对应的本地档案。",
            },
        )

    correction_terms = (
        transcribe_request.context_settings.correction_terms
        if transcribe_request.context_settings
        else []
    )
    try:
        record_term_usage(correction_terms)
    except (CorrectionTermError, sqlite3.Error, OSError) as error:
        # 术语统计属于辅助记录，不能覆盖已经成功生成的转写稿。
        logger.warning(
            "correction term usage update failed: %s",
            error.__class__.__name__,
        )

    return transcribe_response


def _get_transcribe_prompt_context(source_url: str) -> dict[str, object]:
    """
    从本地历史读取媒体上下文，用于校对上下文；读取失败不阻断转写。
    """
    try:
        detail = get_library_detail_by_source_url(source_url)
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "library context lookup failed for transcription: %s",
            error.__class__.__name__,
        )
        return {}

    if detail is None:
        return {}

    shownotes_plain_text = detail.shownotes_plain_text
    if (
        not shownotes_plain_text
        and detail.video.text_source_type == "shownotes"
    ):
        # 兼容功能上线前的旧历史：当时 shownotes 只存在 transcript.plain_text。
        shownotes_plain_text = detail.transcript.plain_text

    return {
        "title": detail.video.title,
        "author": detail.video.author,
        "platform": detail.video.platform,
        "media_type": detail.video.media_type,
        "shownotes_plain_text": shownotes_plain_text,
    }


def _hydrate_summarize_request_from_library(
    summarize_request: SummarizeRequest,
) -> SummarizeRequest:
    """从本地历史补回原始 shownotes 和已提取上下文，不重复调用 AI。"""
    if not summarize_request.source_url:
        return summarize_request

    try:
        detail = get_library_detail_by_source_url(summarize_request.source_url)
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "library shownotes lookup failed for summary: %s",
            error.__class__.__name__,
        )
        return summarize_request

    if detail is None:
        return summarize_request

    updates: dict[str, object] = {}
    if detail.shownotes_plain_text:
        updates["shownotes_plain_text"] = detail.shownotes_plain_text
    if detail.shownotes_context is not None:
        updates["shownotes_context"] = detail.shownotes_context
    return summarize_request.model_copy(update=updates) if updates else summarize_request
