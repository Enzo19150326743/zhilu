"""FastAPI 组装入口：生命周期、统一错误响应和路由注册。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# 配置必须先于业务路由加载，避免服务在导入时读到旧环境。
from app.config import APP_VERSION, FRONTEND_ORIGINS
from app.routers import analysis, correction_terms, library, media, status, tasks
from app.schemas import ApiError
from app.services.task_runner import start_task_runner, stop_task_runner


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
for router in (
    tasks.router,
    status.router,
    correction_terms.router,
    library.router,
    media.router,
    analysis.router,
):
    app.include_router(router)


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
