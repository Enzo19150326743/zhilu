import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app.schemas import (
    CorrectionTermFolder,
    CorrectionTermItem,
    CorrectionTermLibraryResponse,
    MAX_CORRECTION_TERM_LENGTH,
    MAX_CORRECTION_TERMS,
)

DATABASE_PATH = Path(__file__).resolve().parents[2] / "data" / "local_library.sqlite3"
LEGACY_GLOSSARY_PATH = Path(__file__).resolve().parents[3] / "docs" / "asr-glossary.md"
DEFAULT_FOLDER_NAME = "系统默认"


class CorrectionTermError(ValueError):
    """可安全返回给本地前端的术语库业务错误。"""

    def __init__(self, error_code: str, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


def get_term_library() -> CorrectionTermLibraryResponse:
    with _connect() as connection:
        _ensure_schema(connection)
        folder_rows = connection.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM correction_term_folders
            ORDER BY normalized_name ASC, id ASC
            """
        ).fetchall()
        term_rows = connection.execute(
            """
            SELECT id, text, folder_id, usage_count, last_used_at, created_at, updated_at
            FROM correction_terms
            ORDER BY normalized_text ASC, id ASC
            """
        ).fetchall()

    return CorrectionTermLibraryResponse(
        folders=[CorrectionTermFolder(**dict(row)) for row in folder_rows],
        terms=[CorrectionTermItem(**dict(row)) for row in term_rows],
    )


def create_folder(name: str) -> None:
    folder_name = _normalize_text(name, max_length=60, field_label="文件夹名称")
    now = _utc_now()
    with _connect() as connection:
        _ensure_schema(connection)
        try:
            connection.execute(
                """
                INSERT INTO correction_term_folders (
                    name, normalized_name, created_at, updated_at
                ) VALUES (?, ?, ?, ?)
                """,
                (folder_name, folder_name.casefold(), now, now),
            )
        except sqlite3.IntegrityError as error:
            raise CorrectionTermError(
                "CORRECTION_TERM_FOLDER_EXISTS",
                "已经存在同名术语文件夹。",
                status_code=409,
            ) from error


def rename_folder(folder_id: int, name: str) -> None:
    folder_name = _normalize_text(name, max_length=60, field_label="文件夹名称")
    with _connect() as connection:
        _ensure_schema(connection)
        try:
            cursor = connection.execute(
                """
                UPDATE correction_term_folders
                SET name = ?, normalized_name = ?, updated_at = ?
                WHERE id = ?
                """,
                (folder_name, folder_name.casefold(), _utc_now(), folder_id),
            )
        except sqlite3.IntegrityError as error:
            raise CorrectionTermError(
                "CORRECTION_TERM_FOLDER_EXISTS",
                "已经存在同名术语文件夹。",
                status_code=409,
            ) from error

        if cursor.rowcount == 0:
            raise CorrectionTermError(
                "CORRECTION_TERM_FOLDER_NOT_FOUND",
                "术语文件夹不存在或已被删除。",
                status_code=404,
            )


def delete_folder(folder_id: int) -> None:
    with _connect() as connection:
        _ensure_schema(connection)
        _require_folder(connection, folder_id)
        now = _utc_now()
        # 删除分类不应删除用户积累的术语，统一回到“未分类”。
        connection.execute(
            """
            UPDATE correction_terms
            SET folder_id = NULL, updated_at = ?
            WHERE folder_id = ?
            """,
            (now, folder_id),
        )
        connection.execute(
            "DELETE FROM correction_term_folders WHERE id = ?",
            (folder_id,),
        )


def add_terms(terms: list[str], folder_id: int | None = None) -> tuple[int, int]:
    normalized_terms = _normalize_terms(terms)
    now = _utc_now()
    created_count = 0
    with _connect() as connection:
        _ensure_schema(connection)
        if folder_id is not None:
            _require_folder(connection, folder_id)

        for term, normalized_key in normalized_terms:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO correction_terms (
                    text, normalized_text, folder_id, usage_count,
                    last_used_at, created_at, updated_at
                ) VALUES (?, ?, ?, 0, NULL, ?, ?)
                """,
                (term, normalized_key, folder_id, now, now),
            )
            created_count += max(0, cursor.rowcount)

    return created_count, len(normalized_terms) - created_count


def rename_term(term_id: int, text: str) -> None:
    term = _normalize_text(
        text,
        max_length=MAX_CORRECTION_TERM_LENGTH,
        field_label="AI 校对术语",
    )
    with _connect() as connection:
        _ensure_schema(connection)
        try:
            cursor = connection.execute(
                """
                UPDATE correction_terms
                SET text = ?, normalized_text = ?, updated_at = ?
                WHERE id = ?
                """,
                (term, term.casefold(), _utc_now(), term_id),
            )
        except sqlite3.IntegrityError as error:
            raise CorrectionTermError(
                "CORRECTION_TERM_EXISTS",
                "术语库中已经存在这个正确写法。",
                status_code=409,
            ) from error

        if cursor.rowcount == 0:
            raise CorrectionTermError(
                "CORRECTION_TERM_NOT_FOUND",
                "术语不存在或已被删除。",
                status_code=404,
            )


def move_terms(term_ids: list[int], folder_id: int | None) -> int:
    normalized_ids = _normalize_term_ids(term_ids)
    with _connect() as connection:
        _ensure_schema(connection)
        if folder_id is not None:
            _require_folder(connection, folder_id)
        _require_terms(connection, normalized_ids)
        placeholders = ",".join("?" for _ in normalized_ids)
        cursor = connection.execute(
            f"""
            UPDATE correction_terms
            SET folder_id = ?, updated_at = ?
            WHERE id IN ({placeholders})
            """,
            (folder_id, _utc_now(), *normalized_ids),
        )
    return max(0, cursor.rowcount)


def delete_terms(term_ids: list[int]) -> int:
    normalized_ids = _normalize_term_ids(term_ids)
    with _connect() as connection:
        _ensure_schema(connection)
        placeholders = ",".join("?" for _ in normalized_ids)
        cursor = connection.execute(
            f"DELETE FROM correction_terms WHERE id IN ({placeholders})",
            normalized_ids,
        )
    return max(0, cursor.rowcount)


def record_term_usage(terms: list[str]) -> None:
    """转写成功后原子写入新术语，并更新本次选择的使用统计。"""
    if not terms:
        return
    normalized_terms = _normalize_terms(terms)

    now = _utc_now()
    with _connect() as connection:
        _ensure_schema(connection)
        for term, normalized_key in normalized_terms:
            connection.execute(
                """
                INSERT OR IGNORE INTO correction_terms (
                    text, normalized_text, folder_id, usage_count,
                    last_used_at, created_at, updated_at
                ) VALUES (?, ?, NULL, 0, NULL, ?, ?)
                """,
                (term, normalized_key, now, now),
            )
            connection.execute(
                """
                UPDATE correction_terms
                SET usage_count = usage_count + 1,
                    last_used_at = ?,
                    updated_at = ?
                WHERE normalized_text = ?
                """,
                (now, now, normalized_key),
            )


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _ensure_schema(connection: sqlite3.Connection) -> None:
    term_table_existed = (
        connection.execute(
            """
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'correction_terms'
            """
        ).fetchone()
        is not None
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS correction_term_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS correction_terms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            normalized_text TEXT NOT NULL UNIQUE,
            folder_id INTEGER NULL,
            usage_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (folder_id)
                REFERENCES correction_term_folders(id)
                ON DELETE SET NULL
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_correction_terms_folder
        ON correction_terms(folder_id)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_correction_terms_recent
        ON correction_terms(last_used_at DESC)
        """
    )

    if not term_table_existed:
        _seed_legacy_glossary(connection)


def _seed_legacy_glossary(connection: sqlite3.Connection) -> None:
    legacy_terms = _read_legacy_glossary_terms()
    if not legacy_terms:
        return

    now = _utc_now()
    cursor = connection.execute(
        """
        INSERT INTO correction_term_folders (
            name, normalized_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?)
        """,
        (DEFAULT_FOLDER_NAME, DEFAULT_FOLDER_NAME.casefold(), now, now),
    )
    folder_id = int(cursor.lastrowid)
    for term, normalized_key in legacy_terms:
        connection.execute(
            """
            INSERT OR IGNORE INTO correction_terms (
                text, normalized_text, folder_id, usage_count,
                last_used_at, created_at, updated_at
            ) VALUES (?, ?, ?, 0, NULL, ?, ?)
            """,
            (term, normalized_key, folder_id, now, now),
        )


def _read_legacy_glossary_terms() -> list[tuple[str, str]]:
    try:
        lines = LEGACY_GLOSSARY_PATH.read_text(encoding="utf-8").splitlines()
    except (FileNotFoundError, OSError):
        return []

    raw_terms = [
        line.strip()[1:].strip()
        for line in lines
        if line.strip().startswith(("-", "*", "+"))
    ]
    if not raw_terms:
        return []
    return _normalize_terms(raw_terms)


def _normalize_terms(terms: list[str]) -> list[tuple[str, str]]:
    if len(terms) > MAX_CORRECTION_TERMS:
        raise CorrectionTermError(
            "CORRECTION_TERM_LIMIT_EXCEEDED",
            f"每次最多处理 {MAX_CORRECTION_TERMS} 个 AI 校对术语。",
        )

    normalized_terms: list[tuple[str, str]] = []
    seen_terms: set[str] = set()
    for raw_term in terms:
        term = _normalize_text(
            raw_term,
            max_length=MAX_CORRECTION_TERM_LENGTH,
            field_label="AI 校对术语",
        )
        normalized_key = term.casefold()
        if normalized_key in seen_terms:
            continue

        seen_terms.add(normalized_key)
        normalized_terms.append((term, normalized_key))

    if not normalized_terms:
        raise CorrectionTermError(
            "CORRECTION_TERM_EMPTY",
            "请至少提供一个有效的 AI 校对术语。",
        )
    return normalized_terms


def _normalize_text(value: str, *, max_length: int, field_label: str) -> str:
    normalized_value = " ".join(value.strip().split()) if isinstance(value, str) else ""
    if not normalized_value:
        raise CorrectionTermError(
            "CORRECTION_TERM_INVALID",
            f"{field_label}不能为空。",
        )
    if len(normalized_value) > max_length:
        raise CorrectionTermError(
            "CORRECTION_TERM_TOO_LONG",
            f"{field_label}不能超过 {max_length} 个字符。",
        )
    return normalized_value


def _normalize_term_ids(term_ids: list[int]) -> list[int]:
    normalized_ids = list(dict.fromkeys(term_id for term_id in term_ids if term_id > 0))
    if not normalized_ids:
        raise CorrectionTermError(
            "CORRECTION_TERM_SELECTION_EMPTY",
            "请至少选择一个术语。",
        )
    if len(normalized_ids) > MAX_CORRECTION_TERMS:
        raise CorrectionTermError(
            "CORRECTION_TERM_LIMIT_EXCEEDED",
            f"每次最多操作 {MAX_CORRECTION_TERMS} 个术语。",
        )
    return normalized_ids


def _require_folder(connection: sqlite3.Connection, folder_id: int) -> None:
    row = connection.execute(
        "SELECT 1 FROM correction_term_folders WHERE id = ?",
        (folder_id,),
    ).fetchone()
    if row is None:
        raise CorrectionTermError(
            "CORRECTION_TERM_FOLDER_NOT_FOUND",
            "术语文件夹不存在或已被删除。",
            status_code=404,
        )


def _require_terms(connection: sqlite3.Connection, term_ids: list[int]) -> None:
    placeholders = ",".join("?" for _ in term_ids)
    row = connection.execute(
        f"SELECT COUNT(*) AS count FROM correction_terms WHERE id IN ({placeholders})",
        term_ids,
    ).fetchone()
    if row is None or int(row["count"]) != len(term_ids):
        raise CorrectionTermError(
            "CORRECTION_TERM_NOT_FOUND",
            "部分术语不存在或已被删除，请刷新后重试。",
            status_code=404,
        )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
