"""服务状态、推荐内容与公开封面接口。"""

import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.config import (
    APP_VERSION,
    PARSE_RATE_LIMIT_PER_HOUR,
    QA_RATE_LIMIT_PER_HOUR,
    SUMMARY_RATE_LIMIT_PER_HOUR,
    TRANSCRIBE_RATE_LIMIT_PER_HOUR,
)
from app.demo_data import get_demo_by_id, load_demo_seed
from app.schemas import (
    AsrStatusResponse,
    BilibiliAuthStatusResponse,
    DemoItem,
    DemoListResponse,
    HealthResponse,
    ParseResponse,
    RateLimitStatusResponse,
)
from app.services import http_fetch_service
from app.services.bilibili_service import get_bilibili_auth_status
from app.services.demo_cover_service import resolve_demo_cover_url
from app.services.rate_limit_service import get_rate_limit_items
from app.services.sensevoice_service import (
    DEFAULT_SENSEVOICE_MODEL,
    get_sensevoice_status,
)
from app.services.transcript_correction_service import get_transcript_correction_status


router = APIRouter()
logger = logging.getLogger(__name__)
IMAGE_PROXY_TIMEOUT_SECONDS = 15
IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024
IMAGE_PROXY_ACCEPT_HEADER = (
    "image/avif,image/webp,image/apng,image/png,image/jpeg,"
    "image/*;q=0.8,*/*;q=0.5"
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


@router.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """
    返回本地服务状态。
    """
    return HealthResponse(status="ok", mode="local", version=APP_VERSION)


@router.get("/api/asr/status", response_model=AsrStatusResponse)
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


@router.get("/api/image-proxy")
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


@router.get("/api/rate-limit/status", response_model=RateLimitStatusResponse)
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


@router.get("/api/bilibili/auth/status", response_model=BilibiliAuthStatusResponse)
def get_bilibili_local_auth_status() -> BilibiliAuthStatusResponse:
    """
    返回本地显式 B 站 Cookie 配置是否可被 nav 接口识别。
    """
    return get_bilibili_auth_status()


@router.get("/api/demo", response_model=DemoListResponse)
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


@router.get("/api/demo/{demo_id}/cover")
def get_demo_cover(demo_id: str) -> Response:
    """返回推荐内容当前可用的媒体源封面。"""
    demo = get_demo_by_id(demo_id)
    if demo is None:
        raise HTTPException(status_code=404, detail="未找到该推荐内容。")

    cover_url = resolve_demo_cover_url(demo)
    if not cover_url:
        raise HTTPException(status_code=404, detail="该推荐内容暂时没有可用封面。")

    return proxy_public_image(url=cover_url)


@router.get("/api/demo/{demo_id}", response_model=ParseResponse)
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
