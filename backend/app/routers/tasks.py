"""批处理任务 API。"""

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.schemas import (
    TaskActionResponse,
    TaskBatchActionRequest,
    TaskBatchCreateRequest,
    TaskBatchListResponse,
    TaskBatchResponse,
)
from app.services.task_runner import get_task_store
from app.services.task_store import TaskStoreError
from app.services.url_normalization_service import normalize_public_video_url

router = APIRouter(prefix="/api")


def _raise(error: TaskStoreError) -> None:
    raise HTTPException(
        status_code=error.status_code,
        detail={"success": False, "error_code": error.error_code, "message": error.message},
    ) from error


@router.post("/task-batches", response_model=TaskBatchResponse, status_code=status.HTTP_202_ACCEPTED)
def create_task_batch(request: Request, batch_request: TaskBatchCreateRequest) -> dict:
    try:
        normalized = [normalize_public_video_url(value) for value in batch_request.urls]
        batch_id = get_task_store().create_batch(
            client_request_id=batch_request.client_request_id,
            urls=normalized,
            target=batch_request.target,
            settings={
                "asr_engine": batch_request.asr_engine,
                "context_settings": batch_request.context_settings.model_dump(mode="json") if batch_request.context_settings else None,
                "client_key": request.client.host if request.client else "local",
            },
        )
        snapshot = get_task_store().get_batch(batch_id)
        assert snapshot is not None
        return snapshot
    except TaskStoreError as error:
        _raise(error)


@router.get("/task-batches", response_model=TaskBatchListResponse)
def list_task_batches(limit: int = Query(default=10, ge=1, le=30)) -> dict:
    return get_task_store().list_batches(limit)


@router.get("/task-batches/{batch_id}", response_model=TaskBatchResponse)
def get_task_batch(batch_id: str) -> dict:
    snapshot = get_task_store().get_batch(batch_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail={"success": False, "error_code": "BATCH_NOT_FOUND", "message": "没有找到这个批次。"})
    return snapshot


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    try:
        return {"success": True, "task": get_task_store().get_task(task_id)}
    except TaskStoreError as error:
        _raise(error)


@router.post("/tasks/{task_id}/cancel", response_model=TaskActionResponse)
def cancel_task(task_id: str, request: TaskBatchActionRequest) -> dict:
    try:
        store = get_task_store()
        store.cancel(task_id, request.batch_id)
        return {"task": store.get_task_item(task_id, request.batch_id)}
    except TaskStoreError as error:
        _raise(error)


@router.post("/tasks/{task_id}/retry", response_model=TaskActionResponse)
def retry_task(task_id: str, request: TaskBatchActionRequest) -> dict:
    try:
        store = get_task_store()
        store.retry(task_id, request.batch_id)
        return {"task": store.get_task_item(task_id, request.batch_id)}
    except TaskStoreError as error:
        _raise(error)
