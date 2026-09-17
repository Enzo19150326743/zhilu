"""SQLite 持久化批处理任务存储。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from app.services.library_service import DATABASE_PATH

ACTIVE_STATUSES = ("queued", "running", "waiting_retry")
TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")
MAX_ACTIVE_TASKS = 49


class TaskStoreError(Exception):
    def __init__(self, error_code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class TaskStore:
    def __init__(self, database_path: Path = DATABASE_PATH):
        self.database_path = Path(database_path)
        self.initialize()

    @contextmanager
    def connect(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect(immediate=True) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS processing_batches (
                    id TEXT PRIMARY KEY,
                    client_request_id TEXT NOT NULL UNIQUE,
                    request_hash TEXT NOT NULL,
                    target TEXT NOT NULL,
                    settings_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS processing_tasks (
                    id TEXT PRIMARY KEY,
                    source_url TEXT NOT NULL,
                    normalized_url TEXT NOT NULL,
                    content_key TEXT,
                    target TEXT NOT NULL,
                    settings_json TEXT NOT NULL,
                    settings_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at TEXT,
                    execution_token TEXT,
                    checkpoint_json TEXT NOT NULL DEFAULT '{}',
                    video_id TEXT,
                    title TEXT,
                    author TEXT,
                    platform TEXT,
                    thumbnail TEXT,
                    error_code TEXT,
                    error_message TEXT,
                    warning TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_processing_tasks_active
                    ON processing_tasks(status, updated_at);
                CREATE INDEX IF NOT EXISTS idx_processing_tasks_identity
                    ON processing_tasks(normalized_url, target, settings_hash);
                CREATE TABLE IF NOT EXISTS processing_batch_items (
                    batch_id TEXT NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
                    task_id TEXT NOT NULL REFERENCES processing_tasks(id),
                    input_index INTEGER NOT NULL,
                    cancelled_at TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (batch_id, task_id),
                    UNIQUE (batch_id, input_index)
                );
                """
            )

    def create_batch(
        self,
        *,
        client_request_id: str,
        urls: list[str],
        target: str,
        settings: dict[str, Any],
    ) -> str:
        unique_urls = list(dict.fromkeys(urls))
        if not unique_urls or len(unique_urls) > MAX_ACTIVE_TASKS:
            raise TaskStoreError("BATCH_SIZE_INVALID", "每批需要 1～49 条有效链接。", 422)
        settings_json = _stable_json(settings)
        identity_settings = {key: value for key, value in settings.items() if key != "client_key"}
        settings_hash = _hash(_stable_json(identity_settings))
        request_hash = _hash(_stable_json({"urls": unique_urls, "target": target, "settings": identity_settings}))
        timestamp = _now()
        with self.connect(immediate=True) as connection:
            existing = connection.execute(
                "SELECT id, request_hash FROM processing_batches WHERE client_request_id = ?",
                (client_request_id,),
            ).fetchone()
            if existing:
                if existing["request_hash"] != request_hash:
                    raise TaskStoreError(
                        "IDEMPOTENCY_KEY_CONFLICT",
                        "这次提交标识已用于另一组链接，请重新开始提交。",
                        409,
                    )
                return str(existing["id"])

            reusable: dict[str, sqlite3.Row] = {}
            for url in unique_urls:
                row = connection.execute(
                    """
                    SELECT * FROM processing_tasks
                    WHERE normalized_url = ? AND target = ? AND settings_hash = ?
                      AND status IN ('queued', 'running', 'waiting_retry')
                    ORDER BY created_at LIMIT 1
                    """,
                    (url, target, settings_hash),
                ).fetchone()
                if row:
                    reusable[url] = row
            new_count = len(unique_urls) - len(reusable)
            active_count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM processing_tasks WHERE status IN ('queued','running','waiting_retry')"
                ).fetchone()[0]
            )
            if active_count + new_count > MAX_ACTIVE_TASKS:
                raise TaskStoreError(
                    "ACTIVE_TASK_CAPACITY_EXCEEDED",
                    f"当前还有 {active_count} 条任务未结束，最多只能同时保留 49 条。",
                    409,
                )

            batch_id = uuid.uuid4().hex
            connection.execute(
                "INSERT INTO processing_batches VALUES (?, ?, ?, ?, ?, ?, ?)",
                (batch_id, client_request_id, request_hash, target, settings_json, timestamp, timestamp),
            )
            for index, url in enumerate(unique_urls):
                task_id = str(reusable[url]["id"]) if url in reusable else uuid.uuid4().hex
                if url not in reusable:
                    connection.execute(
                        """
                        INSERT INTO processing_tasks (
                            id, source_url, normalized_url, target, settings_json,
                            settings_hash, status, stage, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'parse', ?, ?)
                        """,
                        (task_id, url, url, target, settings_json, settings_hash, timestamp, timestamp),
                    )
                connection.execute(
                    "INSERT INTO processing_batch_items VALUES (?, ?, ?, NULL, ?)",
                    (batch_id, task_id, index, timestamp),
                )
            return batch_id

    def claim_next(self) -> dict[str, Any] | None:
        with self.connect(immediate=True) as connection:
            row = connection.execute(
                """
                SELECT t.* FROM processing_tasks t
                WHERE t.status = 'queued'
                  AND EXISTS (
                    SELECT 1 FROM processing_batch_items i
                    WHERE i.task_id = t.id AND i.cancelled_at IS NULL
                  )
                ORDER BY t.created_at, t.id LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            token = uuid.uuid4().hex
            timestamp = _now()
            changed = connection.execute(
                """
                UPDATE processing_tasks
                SET status='running', execution_token=?, attempt_count=attempt_count+1,
                    error_code=NULL, error_message=NULL, updated_at=?
                WHERE id=? AND status='queued'
                """,
                (token, timestamp, row["id"]),
            ).rowcount
            if not changed:
                return None
            result = dict(row)
            result["execution_token"] = token
            result["settings"] = json.loads(str(row["settings_json"]))
            result["checkpoint"] = json.loads(str(row["checkpoint_json"]))
            return result

    def promote_due_retries(self) -> int:
        with self.connect(immediate=True) as connection:
            return connection.execute(
                """UPDATE processing_tasks SET status='queued', next_attempt_at=NULL, updated_at=?
                   WHERE status='waiting_retry' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?""",
                (_now(), _now()),
            ).rowcount

    def defer_until(self, task_id: str, token: str, next_attempt_at: str, message: str) -> bool:
        with self.connect(immediate=True) as connection:
            return bool(connection.execute(
                """UPDATE processing_tasks SET status='waiting_retry', next_attempt_at=?,
                   error_code='RATE_LIMIT_WAIT', error_message=?, execution_token=NULL, updated_at=?
                   WHERE id=? AND execution_token=? AND status='running'""",
                (next_attempt_at, message, _now(), task_id, token),
            ).rowcount)

    def update_running(self, task_id: str, token: str, **changes: Any) -> bool:
        allowed = {
            "stage", "status", "checkpoint_json", "video_id", "content_key",
            "title", "author", "platform", "thumbnail", "error_code",
            "error_message", "warning", "next_attempt_at",
        }
        fields = {key: value for key, value in changes.items() if key in allowed}
        if "checkpoint_json" in fields and not isinstance(fields["checkpoint_json"], str):
            fields["checkpoint_json"] = _stable_json(fields["checkpoint_json"])
        fields["updated_at"] = _now()
        assignments = ", ".join(f"{key}=?" for key in fields)
        with self.connect(immediate=True) as connection:
            changed = connection.execute(
                f"UPDATE processing_tasks SET {assignments} WHERE id=? AND execution_token=? AND status='running'",
                (*fields.values(), task_id, token),
            ).rowcount
            return bool(changed)

    def finish(self, task_id: str, token: str, *, warning: str | None = None) -> bool:
        with self.connect(immediate=True) as connection:
            changed = connection.execute(
                """
                UPDATE processing_tasks SET status='succeeded', stage='done', warning=?,
                    execution_token=NULL, updated_at=?
                WHERE id=? AND execution_token=? AND status='running'
                """,
                (warning, _now(), task_id, token),
            ).rowcount
            return bool(changed)

    def fail(self, task_id: str, token: str, error_code: str, message: str) -> bool:
        with self.connect(immediate=True) as connection:
            changed = connection.execute(
                """
                UPDATE processing_tasks SET status='failed', error_code=?, error_message=?,
                    execution_token=NULL, updated_at=?
                WHERE id=? AND execution_token=? AND status='running'
                """,
                (error_code, message[:500], _now(), task_id, token),
            ).rowcount
            return bool(changed)

    def recover_interrupted(self) -> int:
        with self.connect(immediate=True) as connection:
            timestamp = _now()
            uncertain = connection.execute(
                """
                UPDATE processing_tasks SET status='failed', execution_token=NULL,
                    error_code='AI_RESULT_UNCERTAIN',
                    error_message='AI 请求期间服务中断，结果是否产生无法确认。为避免重复计费，请确认后手动重试。',
                    updated_at=?
                WHERE status='running'
                  AND json_extract(checkpoint_json, '$.ai_inflight') IS NOT NULL
                """,
                (timestamp,),
            ).rowcount
            recovered = connection.execute(
                """
                UPDATE processing_tasks SET status='queued', execution_token=NULL,
                    error_code='PROCESS_RESTARTED', error_message='服务重启后已从最近检查点恢复。', updated_at=?
                WHERE status='running'
                """,
                (timestamp,),
            ).rowcount
            return uncertain + recovered

    def cancel(self, task_id: str, batch_id: str) -> None:
        with self.connect(immediate=True) as connection:
            timestamp = _now()
            changed = connection.execute(
                """UPDATE processing_batch_items SET cancelled_at=COALESCE(cancelled_at, ?)
                   WHERE batch_id=? AND task_id=?""",
                (timestamp, batch_id, task_id),
            ).rowcount
            if not changed:
                raise TaskStoreError("TASK_NOT_FOUND", "没有找到这条批次任务。", 404)
            remaining = int(connection.execute(
                "SELECT COUNT(*) FROM processing_batch_items WHERE task_id=? AND cancelled_at IS NULL",
                (task_id,),
            ).fetchone()[0])
            if remaining == 0:
                connection.execute(
                    """UPDATE processing_tasks SET status='cancelled', stage='done', updated_at=?
                       WHERE id=? AND status IN ('queued','waiting_retry')""",
                    (timestamp, task_id),
                )

    def retry(self, task_id: str, batch_id: str) -> None:
        with self.connect(immediate=True) as connection:
            row = connection.execute(
                "SELECT status FROM processing_tasks WHERE id=?", (task_id,)
            ).fetchone()
            if row is None or connection.execute(
                "SELECT 1 FROM processing_batch_items WHERE batch_id=? AND task_id=?",
                (batch_id, task_id),
            ).fetchone() is None:
                raise TaskStoreError("TASK_NOT_FOUND", "没有找到这条批次任务。", 404)
            if row["status"] in ACTIVE_STATUSES:
                connection.execute(
                    "UPDATE processing_batch_items SET cancelled_at=NULL WHERE batch_id=? AND task_id=?",
                    (batch_id, task_id),
                )
                return
            active_count = int(connection.execute(
                "SELECT COUNT(*) FROM processing_tasks WHERE status IN ('queued','running','waiting_retry')"
            ).fetchone()[0])
            if active_count >= MAX_ACTIVE_TASKS:
                raise TaskStoreError("ACTIVE_TASK_CAPACITY_EXCEEDED", "当前任务已满，请等待其他任务结束。", 409)
            timestamp = _now()
            connection.execute(
                "UPDATE processing_batch_items SET cancelled_at=NULL WHERE batch_id=? AND task_id=?",
                (batch_id, task_id),
            )
            connection.execute(
                """UPDATE processing_tasks SET status='queued', execution_token=NULL,
                   error_code=NULL, error_message=NULL, updated_at=? WHERE id=?""",
                (timestamp, task_id),
            )

    def get_batch(self, batch_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            batch = connection.execute(
                "SELECT * FROM processing_batches WHERE id=?", (batch_id,)
            ).fetchone()
            if batch is None:
                return None
            items = connection.execute(
                """
                SELECT t.*, i.input_index, i.cancelled_at
                FROM processing_batch_items i JOIN processing_tasks t ON t.id=i.task_id
                WHERE i.batch_id=? ORDER BY i.input_index
                """,
                (batch_id,),
            ).fetchall()
            return self._batch_snapshot(batch, items)

    def list_batches(self, limit: int = 10) -> dict[str, Any]:
        with self.connect() as connection:
            batches = connection.execute(
                "SELECT * FROM processing_batches ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            summaries = []
            for batch in batches:
                items = connection.execute(
                    """SELECT t.*, i.input_index, i.cancelled_at FROM processing_batch_items i
                       JOIN processing_tasks t ON t.id=i.task_id WHERE i.batch_id=?""",
                    (batch["id"],),
                ).fetchall()
                snapshot = self._batch_snapshot(batch, items)
                summaries.append({
                    "batch_id": snapshot["batch_id"], "target": snapshot["target"],
                    "created_at": snapshot["created_at"], "stats": snapshot["stats"],
                })
            active = int(connection.execute(
                "SELECT COUNT(*) FROM processing_tasks WHERE status IN ('queued','running','waiting_retry')"
            ).fetchone()[0])
            active_video_ids = [
                str(row[0])
                for row in connection.execute(
                    """SELECT DISTINCT video_id FROM processing_tasks
                       WHERE status IN ('queued','running','waiting_retry') AND video_id IS NOT NULL"""
                ).fetchall()
            ]
            return {"active_task_count": active, "active_video_ids": active_video_ids, "batches": summaries}

    def get_task_item(self, task_id: str, batch_id: str) -> dict[str, Any]:
        batch = self.get_batch(batch_id)
        if batch:
            for item in batch["items"]:
                if item["task_id"] == task_id:
                    return item
        raise TaskStoreError("TASK_NOT_FOUND", "没有找到这条批次任务。", 404)

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT t.*, i.input_index, i.cancelled_at FROM processing_tasks t
                   LEFT JOIN processing_batch_items i ON i.task_id=t.id
                   WHERE t.id=? ORDER BY i.cancelled_at IS NULL DESC, i.created_at LIMIT 1""",
                (task_id,),
            ).fetchone()
            if row is None:
                raise TaskStoreError("TASK_NOT_FOUND", "没有找到这条任务。", 404)
            fake_batch = {"id": "", "client_request_id": "", "target": row["target"], "created_at": row["created_at"]}
            return self._batch_snapshot(fake_batch, [row])["items"][0]

    def has_active_tasks(self, *, video_id: str | None = None) -> bool:
        with self.connect() as connection:
            if video_id is None:
                row = connection.execute(
                    "SELECT 1 FROM processing_tasks WHERE status IN ('queued','running','waiting_retry') LIMIT 1"
                ).fetchone()
            else:
                row = connection.execute(
                    """SELECT 1 FROM processing_tasks WHERE video_id=?
                       AND status IN ('queued','running','waiting_retry') LIMIT 1""",
                    (video_id,),
                ).fetchone()
            return row is not None

    @staticmethod
    def _batch_snapshot(batch: sqlite3.Row, rows: list[sqlite3.Row]) -> dict[str, Any]:
        items = []
        counts = {"active": 0, "succeeded": 0, "failed": 0, "cancelled": 0}
        for row in rows:
            cancelled = row["cancelled_at"] is not None
            status = "cancelled" if cancelled else str(row["status"])
            if status in ACTIVE_STATUSES:
                counts["active"] += 1
            elif status in counts:
                counts[status] += 1
            items.append({
                "task_id": row["id"], "input_index": row["input_index"],
                "source_url": row["source_url"], "status": status, "stage": row["stage"],
                "title": row["title"], "author": row["author"], "platform": row["platform"],
                "thumbnail": row["thumbnail"], "video_id": row["video_id"],
                "error_code": row["error_code"], "error_message": row["error_message"],
                "warning": row["warning"], "cancelled": cancelled,
                "result_available": bool(row["video_id"]), "updated_at": row["updated_at"],
            })
        return {
            "batch_id": batch["id"], "client_request_id": batch["client_request_id"],
            "target": batch["target"], "created_at": batch["created_at"],
            "stats": {"total": len(items), **counts}, "items": items,
        }
