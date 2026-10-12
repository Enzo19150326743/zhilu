"""AI 校对术语与文件夹接口。"""

from fastapi import APIRouter, HTTPException

from app.schemas import (
    CorrectionTermBatchDeleteRequest,
    CorrectionTermBatchMoveRequest,
    CorrectionTermBulkCreateRequest,
    CorrectionTermFolderRequest,
    CorrectionTermLibraryResponse,
    CorrectionTermMutationResponse,
    CorrectionTermRenameRequest,
)
from app.services.correction_term_service import (
    CorrectionTermError,
    add_terms,
    create_folder,
    delete_folder,
    delete_terms,
    get_term_library,
    move_terms,
    rename_folder,
    rename_term,
)


router = APIRouter()


@router.get("/api/correction-terms", response_model=CorrectionTermLibraryResponse)
def get_correction_terms() -> CorrectionTermLibraryResponse:
    """返回本地 AI 校对术语库完整快照。"""
    return get_term_library()


@router.post(
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


@router.patch(
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


@router.delete(
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


@router.post("/api/correction-terms", response_model=CorrectionTermMutationResponse)
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


@router.patch(
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


@router.post(
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


@router.post(
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
