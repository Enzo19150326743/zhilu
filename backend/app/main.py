import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.background import BackgroundTask

from app.demo_data import get_demo_by_id, load_demo_seed
from app.schemas import (
    ApiError,
    AsrStatusResponse,
    BilibiliAuthStatusResponse,
    CorrectionTermBatchDeleteRequest,
    CorrectionTermBatchMoveRequest,
    CorrectionTermBulkCreateRequest,
    CorrectionTermFolderRequest,
    CorrectionTermLibraryResponse,
    CorrectionTermMutationResponse,
    CorrectionTermRenameRequest,
    DemoItem,
    DemoListResponse,
    DownloadRequest,
    DownloadResponse,
    HealthResponse,
    LibraryClearResponse,
    LibraryDeleteResponse,
    LibraryListResponse,
    LibraryStatsResponse,
    NoteDraft,
    NoteDraftUpdateRequest,
    NoteDraftUpdateResponse,
    ObsidianNoteExportRequest,
    ObsidianNoteExportResponse,
    ParseRequest,
    ParseResponse,
    QaRequest,
    QaResponse,
    RateLimitStatusResponse,
    SummarizeRequest,
    SummarizeResponse,
    TranscribeRequest,
    TranscribeResponse,
)
from app.services.asr_service import transcribe_media_audio
from app.services import http_fetch_service
from app.services.bilibili_service import (
    download_bilibili_video_format,
    get_bilibili_auth_status,
    is_bilibili_url,
    resolve_bilibili_transcription_source,
)
from app.services.correction_term_service import (
    CorrectionTermError,
    add_terms,
    create_folder,
    delete_folder,
    delete_terms,
    get_term_library,
    move_terms,
    record_term_usage,
    rename_folder,
    rename_term,
)
from app.services.douyin_service import (
    create_douyin_transcription_downloader,
    download_douyin_video,
    is_douyin_url,
)
from app.services.xiaohongshu_service import is_xiaohongshu_url
from app.services.sensevoice_service import (
    DEFAULT_SENSEVOICE_MODEL,
    get_sensevoice_status,
)
from app.services.demo_cover_service import resolve_demo_cover_url
from app.services.deepseek_client import DeepSeekOutputTruncatedError
from app.services.library_service import (
    clear_library_items,
    delete_library_item,
    get_library_detail,
    get_library_detail_by_source_url,
    get_library_stats,
    list_recent_library_items,
    update_note_draft_for_source_url,
    update_summary_for_source_url,
    update_transcript_for_source_url,
    upsert_library_item,
)
from app.services.media_source_service import parse_media_source
from app.services.obsidian_export_service import (
    ObsidianExportError,
    export_obsidian_note,
)
from app.services.qa_service import answer_question
from app.services.rate_limit_service import (
    get_rate_limit_items,
)
from app.services.summarize_service import summarize_transcript
from app.services.transcript_correction_service import (
    get_transcript_correction_status,
)
from app.services.ytdlp_service import download_video_format
from app.routers.tasks import router as tasks_router
from app.services.task_runner import get_task_store, start_task_runner, stop_task_runner
from app.services.processing_resources import DOWNLOAD_SLOTS, RECOGNITION_SLOT, AI_WORK_SLOTS
from app.services.url_normalization_service import (
    extract_public_url,
    normalize_bilibili_video_url,
    normalize_public_video_url,
)


def read_int_env(name: str, default_value: int) -> int:
    """
    读取整数环境变量，格式错误时使用默认值。
    """
    try:
        return int(os.getenv(name, str(default_value)))
    except ValueError:
        return default_value


APP_VERSION = "0.1.0"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
PARSE_RATE_LIMIT_PER_HOUR = read_int_env("PARSE_RATE_LIMIT_PER_HOUR", 50)
SUMMARY_RATE_LIMIT_PER_HOUR = read_int_env("SUMMARY_RATE_LIMIT_PER_HOUR", 50)
QA_RATE_LIMIT_PER_HOUR = read_int_env("QA_RATE_LIMIT_PER_HOUR", 10)
TRANSCRIBE_RATE_LIMIT_PER_HOUR = read_int_env("TRANSCRIBE_RATE_LIMIT_PER_HOUR", 50)
IMAGE_PROXY_TIMEOUT_SECONDS = 15
IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024
IMAGE_PROXY_ACCEPT_HEADER = (
    "image/avif,image/webp,image/apng,image/png,image/jpeg,"
    "image/*;q=0.8,*/*;q=0.5"
)
logger = logging.getLogger(__name__)
FRONTEND_ORIGINS = {
    FRONTEND_ORIGIN,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    start_task_runner()
    try:
        yield
    finally:
        stop_task_runner()

app = FastAPI(
    title="AI Media Insight Workspace API",
    version=APP_VERSION,
    description="本地优先的 AI 媒体内容解析总结工作台后端服务。",
    lifespan=app_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(FRONTEND_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.include_router(tasks_router)


def build_api_error_response(
    status_code: int, error_code: str, message: str
) -> JSONResponse:
    """
    构造统一错误响应。
    """
    return JSONResponse(
        status_code=status_code,
        content=ApiError(error_code=error_code, message=message).model_dump(),
    )


@app.exception_handler(HTTPException)
def handle_http_exception(_: Request, exc: HTTPException) -> JSONResponse:
    """
    将业务异常统一转换为前端可直接读取的错误结构。
    """
    detail = exc.detail
    if isinstance(detail, dict):
        return build_api_error_response(
            status_code=exc.status_code,
            error_code=str(detail.get("error_code", "HTTP_ERROR")),
            message=str(detail.get("message", "请求失败，请稍后重试。")),
        )

    return build_api_error_response(
        status_code=exc.status_code,
        error_code="HTTP_ERROR",
        message="请求失败，请稍后重试。",
    )


@app.exception_handler(RequestValidationError)
def handle_request_validation_error(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    隐藏 Pydantic 内部校验细节，只给前端稳定错误结构。
    """
    return build_api_error_response(
        status_code=422,
        error_code="VALIDATION_ERROR",
        message="请求参数不完整或格式不正确。",
    )


def get_client_key(request: Request) -> str:
    """
    获取本地频控使用的客户端标识。
    """
    return request.client.host if request.client else "local"


def get_rate_limit_config() -> dict[str, int]:
    """
    返回当前本地频控配置。
    """
    return {
        "parse": PARSE_RATE_LIMIT_PER_HOUR,
        "summarize": SUMMARY_RATE_LIMIT_PER_HOUR,
        "qa": QA_RATE_LIMIT_PER_HOUR,
        "transcribe": TRANSCRIBE_RATE_LIMIT_PER_HOUR,
    }


def enforce_rate_limit(request: Request, action: str, limit: int) -> None:
    """
    个人本地使用阶段不限制高成本动作。
    """
    _ = (request, action, limit)
    return


def build_placeholder_parse_result(video_url: str) -> ParseResponse:
    """
    构造解析失败时的可解释返回。
    """
    return ParseResponse(
        source_url=video_url,
        is_placeholder=True,
        video={
            "video_id": "placeholder_parse_result",
            "platform": "placeholder",
            "url": video_url,
            "title": "媒体解析暂未完成",
            "author": "知录本地解析",
            "duration": 0,
            "thumbnail": "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
            "has_transcript": False,
            "media_type": "media",
            "text_source_type": "content",
        },
        formats=[
            {
                "format_id": "placeholder-format",
                "ext": "mp4",
                "resolution": "待解析",
                "vcodec": "待接入",
                "acodec": "待接入",
                "filesize": None,
                "label": "真实格式待接入",
            }
        ],
        transcript={
            "segments": [
                {
                    "start": 0,
                    "end": 0,
                    "text": "当前链接已通过基础校验，但暂时没有取得可用媒体内容。",
                }
            ],
            "plain_text": "当前链接已通过基础校验，但暂时没有取得可用媒体内容。",
        },
        summary={
            "tldr": "当前链接暂时没有解析出可用媒体内容，请稍后重试或换一个公开链接。",
            "key_points": [
                "链接格式已通过基础校验。",
                "当前没有取得可用于总结的标题、内容文本或下载格式。",
                "拿到内容文本后，再生成结构化总结、摘录和导图。",
            ],
            "timeline": [],
            "structured_analysis_markdown": "## 当前状态\n### 链接已接收\n系统已完成基础校验。\n### 暂未取得内容\n请确认链接公开可访问，或稍后重新解析。",
            "takeaways": [
                "优先使用公开可访问、带标题和内容文本的媒体链接。",
                "平台临时限制访问时，可以稍后重试。",
            ],
        },
        mindmap_markdown="# 媒体解析\n## 当前状态\n### 链接已接收\n## 下一步\n### 重新解析公开可访问链接",
    )


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """
    返回本地服务状态。
    """
    return HealthResponse(status="ok", mode="local", version=APP_VERSION)


@app.get("/api/asr/status", response_model=AsrStatusResponse)
def get_asr_status() -> AsrStatusResponse:
    """返回本地转写能力状态。"""
    sensevoice_available, sensevoice_message = get_sensevoice_status()
    correction_available, correction_message = get_transcript_correction_status()
    return AsrStatusResponse(
        sensevoice_available=sensevoice_available,
        sensevoice_model=(
            os.getenv("SENSEVOICE_MODEL", "").strip()
            or DEFAULT_SENSEVOICE_MODEL
        ),
        sensevoice_message=sensevoice_message,
        correction_available=correction_available,
        correction_message=correction_message,
    )


@app.get("/api/correction-terms", response_model=CorrectionTermLibraryResponse)
def get_correction_terms() -> CorrectionTermLibraryResponse:
    """返回本地 AI 校对术语库完整快照。"""
    return get_term_library()


@app.post(
    "/api/correction-term-folders",
    response_model=CorrectionTermMutationResponse,
)
def create_correction_term_folder(
    folder_request: CorrectionTermFolderRequest,
) -> CorrectionTermMutationResponse:
    try:
        create_folder(folder_request.name)
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(message="术语文件夹已创建。")


@app.patch(
    "/api/correction-term-folders/{folder_id}",
    response_model=CorrectionTermMutationResponse,
)
def rename_correction_term_folder(
    folder_id: int,
    folder_request: CorrectionTermFolderRequest,
) -> CorrectionTermMutationResponse:
    try:
        rename_folder(folder_id, folder_request.name)
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(message="术语文件夹已重命名。")


@app.delete(
    "/api/correction-term-folders/{folder_id}",
    response_model=CorrectionTermMutationResponse,
)
def delete_correction_term_folder(folder_id: int) -> CorrectionTermMutationResponse:
    try:
        delete_folder(folder_id)
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(
        message="文件夹已删除，其中的术语已移到未分类。"
    )


@app.post("/api/correction-terms", response_model=CorrectionTermMutationResponse)
def create_correction_terms(
    term_request: CorrectionTermBulkCreateRequest,
) -> CorrectionTermMutationResponse:
    try:
        created_count, existing_count = add_terms(
            term_request.terms,
            term_request.folder_id,
        )
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(
        message=(
            f"已新增 {created_count} 个术语。"
            if existing_count == 0
            else f"已新增 {created_count} 个术语，{existing_count} 个已存在。"
        )
    )


@app.patch(
    "/api/correction-terms/{term_id}",
    response_model=CorrectionTermMutationResponse,
)
def rename_correction_term(
    term_id: int,
    term_request: CorrectionTermRenameRequest,
) -> CorrectionTermMutationResponse:
    try:
        rename_term(term_id, term_request.text)
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(message="术语已重命名。")


@app.post(
    "/api/correction-terms/batch-move",
    response_model=CorrectionTermMutationResponse,
)
def move_correction_terms(
    term_request: CorrectionTermBatchMoveRequest,
) -> CorrectionTermMutationResponse:
    try:
        moved_count = move_terms(term_request.term_ids, term_request.folder_id)
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(message=f"已移动 {moved_count} 个术语。")


@app.post(
    "/api/correction-terms/batch-delete",
    response_model=CorrectionTermMutationResponse,
)
def delete_correction_terms(
    term_request: CorrectionTermBatchDeleteRequest,
) -> CorrectionTermMutationResponse:
    try:
        deleted_count = delete_terms(term_request.term_ids)
    except CorrectionTermError as error:
        _raise_correction_term_error(error)
    return CorrectionTermMutationResponse(message=f"已删除 {deleted_count} 个术语。")


def _raise_correction_term_error(error: CorrectionTermError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={
            "success": False,
            "error_code": error.error_code,
            "message": error.message,
        },
    ) from error


@app.get("/api/image-proxy")
def proxy_public_image(
    url: str = Query(min_length=8, max_length=2048),
) -> Response:
    """
    代理公开封面图，避免浏览器直连远端 CDN 时被防盗链或本机 TLS 链路拦截。
    """
    try:
        image_body, content_type = http_fetch_service.fetch_public_bytes(
            url,
            accept_header=IMAGE_PROXY_ACCEPT_HEADER,
            timeout_seconds=IMAGE_PROXY_TIMEOUT_SECONDS,
            max_bytes=IMAGE_PROXY_MAX_BYTES,
        )
    except OSError as error:
        logger.warning("image proxy fetch failed: %s", error.__class__.__name__)
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "IMAGE_PROXY_FAILED",
                "message": "封面图片读取失败，请稍后重试。",
            },
        ) from error

    media_type = content_type.split(";", 1)[0].strip().lower()
    if not media_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error_code": "IMAGE_PROXY_INVALID_TYPE",
                "message": "该链接返回的不是图片内容。",
            },
        )

    return Response(
        content=image_body,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/rate-limit/status", response_model=RateLimitStatusResponse)
def get_rate_limit_status(request: Request) -> RateLimitStatusResponse:
    """
    返回当前客户端的本地频控状态。
    """
    return RateLimitStatusResponse(
        items=get_rate_limit_items(
            client_key=get_client_key(request),
            action_limits=get_rate_limit_config(),
        )
    )


@app.get("/api/bilibili/auth/status", response_model=BilibiliAuthStatusResponse)
def get_bilibili_local_auth_status() -> BilibiliAuthStatusResponse:
    """
    返回本地显式 B 站 Cookie 配置是否可被 nav 接口识别。
    """
    return get_bilibili_auth_status()


@app.get("/api/demo", response_model=DemoListResponse)
def list_demos() -> DemoListResponse:
    """
    返回内置的推荐内容列表。
    """
    demos = [
        DemoItem(
            demo_id=demo["demo_id"],
            title=demo["title"],
            description=demo["description"],
            thumbnail=f"/api/demo/{demo['demo_id']}/cover",
        )
        for demo in load_demo_seed()
    ]
    return DemoListResponse(demos=demos)


@app.get("/api/demo/{demo_id}/cover")
def get_demo_cover(demo_id: str) -> Response:
    """返回推荐内容当前可用的媒体源封面。"""
    demo = get_demo_by_id(demo_id)
    if demo is None:
        raise HTTPException(status_code=404, detail="未找到该推荐内容。")

    cover_url = resolve_demo_cover_url(demo)
    if not cover_url:
        raise HTTPException(status_code=404, detail="该推荐内容暂时没有可用封面。")

    return proxy_public_image(url=cover_url)


@app.get("/api/demo/{demo_id}", response_model=ParseResponse)
def get_demo_detail(demo_id: str) -> dict[str, Any]:
    """
    返回推荐内容的精简公开数据。
    """
    demo = get_demo_by_id(demo_id)
    if demo is None:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "error_code": "DEMO_NOT_FOUND",
                "message": "未找到该推荐内容。",
            },
        )

    response = dict(demo)
    video = dict(response["video"])
    video["thumbnail"] = f"/api/demo/{demo_id}/cover"
    response["video"] = video
    response["thumbnail"] = f"/api/demo/{demo_id}/cover"

    return response


@app.get("/api/library/recent", response_model=LibraryListResponse)
def list_recent_library(
    limit: int = Query(default=8, ge=1, le=50),
    filter: Literal["all", "ready", "summarized", "noTranscript"] = Query(
        default="all"
    ),
) -> LibraryListResponse:
    """
    返回最近解析过的媒体记录。
    """
    return LibraryListResponse(
        items=list_recent_library_items(limit=limit, library_filter=filter)
    )


@app.get("/api/library/stats", response_model=LibraryStatsResponse)
def get_local_library_stats() -> LibraryStatsResponse:
    """
    返回本地内容库统计概览。
    """
    return get_library_stats()


@app.put("/api/library/note-draft", response_model=NoteDraftUpdateResponse)
def update_library_note_draft(
    note_draft_request: NoteDraftUpdateRequest,
) -> NoteDraftUpdateResponse:
    """
    保存当前媒体的“我的整理”到本地历史记录。
    """
    source_url = normalize_public_video_url(note_draft_request.source_url)
    note_draft = NoteDraft(
        highlights=note_draft_request.highlights,
        updated_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    try:
        updated_note_draft = update_note_draft_for_source_url(source_url, note_draft)
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "library note draft update failed: %s",
            error.__class__.__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error_code": "NOTE_DRAFT_SAVE_FAILED",
                "message": "我的整理保存失败，请稍后重试。",
            },
        ) from error

    if updated_note_draft is None:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "error_code": "LIBRARY_ITEM_NOT_FOUND",
                "message": "没有找到可保存整理内容的本地历史记录。",
            },
        )

    return NoteDraftUpdateResponse(note_draft=updated_note_draft)


@app.post("/api/exports/obsidian-note", response_model=ObsidianNoteExportResponse)
def export_library_obsidian_note(
    export_request: ObsidianNoteExportRequest,
) -> ObsidianNoteExportResponse:
    """
    生成或写入 Obsidian Markdown 笔记。
    """
    source_url = normalize_public_video_url(export_request.source_url)
    try:
        return export_obsidian_note(
            source_url=source_url,
            include_full_text=export_request.include_full_text,
        )
    except ObsidianExportError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={
                "success": False,
                "error_code": error.error_code,
                "message": error.message,
            },
        ) from error
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "obsidian note export failed: %s",
            error.__class__.__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error_code": "OBSIDIAN_EXPORT_FAILED",
                "message": "Obsidian Markdown 导出失败，请稍后重试。",
            },
        ) from error


@app.delete("/api/library", response_model=LibraryClearResponse)
def clear_local_library() -> LibraryClearResponse:
    """
    清空本地内容库历史记录。
    """
    if get_task_store().has_active_tasks():
        raise HTTPException(
            status_code=409,
            detail={"success": False, "error_code": "ACTIVE_TASKS_EXIST", "message": "仍有批量任务在处理，完成或取消后才能清空档案。"},
        )
    return LibraryClearResponse(deleted_count=clear_library_items())


@app.get("/api/library/{video_id}", response_model=ParseResponse)
def get_library_item(video_id: str) -> ParseResponse:
    """
    返回本地内容库中的完整工作台数据。
    """
    detail = get_library_detail(video_id)
    if detail is None:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "error_code": "LIBRARY_ITEM_NOT_FOUND",
                "message": "未找到该历史记录。",
            },
        )

    return detail


@app.delete("/api/library/{video_id}", response_model=LibraryDeleteResponse)
def delete_library_history_item(video_id: str) -> LibraryDeleteResponse:
    """
    删除本地内容库中的单条历史记录。
    """
    if get_task_store().has_active_tasks(video_id=video_id):
        raise HTTPException(
            status_code=409,
            detail={"success": False, "error_code": "ACTIVE_TASK_EXISTS", "message": "这条档案仍在处理，完成或取消后才能删除。"},
        )
    deleted = delete_library_item(video_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "error_code": "LIBRARY_ITEM_NOT_FOUND",
                "message": "未找到该历史记录。",
            },
        )

    return LibraryDeleteResponse(deleted_video_id=video_id)


def _merge_refreshed_xiaohongshu_detail(
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


@app.post("/api/parse", response_model=ParseResponse)
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

    enforce_rate_limit(request, "parse", PARSE_RATE_LIMIT_PER_HOUR)
    parse_response = parse_media_source(video_url)
    if cached_detail is not None:
        parse_response = _merge_refreshed_xiaohongshu_detail(
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


@app.post("/api/summarize", response_model=SummarizeResponse)
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

    enforce_rate_limit(request, "summarize", SUMMARY_RATE_LIMIT_PER_HOUR)
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


@app.post("/api/qa", response_model=QaResponse)
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

    enforce_rate_limit(request, "qa", QA_RATE_LIMIT_PER_HOUR)
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


@app.post("/api/transcribe", response_model=TranscribeResponse)
def transcribe_video(
    request: Request,
    transcribe_request: TranscribeRequest,
) -> TranscribeResponse:
    """
    当平台没有现成文字时，按用户选择使用本地 ASR 生成转写稿。
    """
    video_url = normalize_public_video_url(transcribe_request.url)
    transcribe_context = _get_transcribe_prompt_context(video_url)
    is_douyin_source = is_douyin_url(video_url)
    transcribe_source_url, transcribe_http_headers = _resolve_transcription_source(
        video_url
    )
    enforce_rate_limit(request, "transcribe", TRANSCRIBE_RATE_LIMIT_PER_HOUR)
    with RECOGNITION_SLOT:
        transcribe_response = transcribe_media_audio(
            video_url=transcribe_source_url,
            video_id=transcribe_request.video_id,
            http_headers=transcribe_http_headers,
            audio_downloader_factory=(
                create_douyin_transcription_downloader if is_douyin_source else None
            ),
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


def _resolve_transcription_source(
    source_url: str,
) -> tuple[str, dict[str, str] | None]:
    """
    页面 URL 通常不是可直接转写的媒体文件，先通过专用适配器取公开媒体直链。
    """
    if is_bilibili_url(source_url):
        bilibili_source = resolve_bilibili_transcription_source(source_url)
        return bilibili_source.audio_url, bilibili_source.http_headers

    if is_douyin_url(source_url):
        # 抖音媒体流必须在解析详情的匿名 Edge 上下文中获取，不能把短时直链交给 yt-dlp。
        return source_url, None

    hostname = urlparse(source_url).hostname or ""
    if (
        not hostname.endswith("xiaoyuzhoufm.com")
        and not is_douyin_url(source_url)
        and not is_xiaohongshu_url(source_url)
    ):
        return source_url, None

    try:
        parse_response = parse_media_source(source_url)
    except HTTPException:
        return source_url, None

    return parse_response.transcription_source_url or source_url, None


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


@app.post("/api/download", response_model=DownloadResponse)
def download_video_legacy(download_request: DownloadRequest) -> DownloadResponse:
    """保留旧 JSON 协议，避免已打开页面把媒体二进制误当作 JSON。"""
    return _prepare_video_download(download_request)


@app.post("/api/download/file", response_class=FileResponse)
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
