import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.schemas import RateLimitItem

DATABASE_PATH = Path(__file__).resolve().parents[2] / "data" / "local_library.sqlite3"
RATE_LIMIT_WINDOW_SECONDS = 3600


@dataclass(frozen=True)
class RateLimitResult:
    """本地频控判断结果。"""

    allowed: bool
    item: RateLimitItem


def check_and_increment_rate_limit(
    client_key: str,
    action: str,
    limit: int,
) -> RateLimitResult:
    """
    检查并记录一次本地动作请求。

    NOTE: V0.2 只做本地轻量保护，避免真实解析和 AI 总结被连续误触发。
    """
    now = datetime.now(UTC)
    safe_limit = max(1, limit)

    with _connect() as connection:
        _ensure_schema(connection)
        row = connection.execute(
            """
            SELECT count, window_start
            FROM rate_limits
            WHERE client_key = ? AND action = ?
            """,
            (client_key, action),
        ).fetchone()

        if row is None or _is_expired(str(row["window_start"]), now):
            window_start = now
            used = 1
            connection.execute(
                """
                INSERT INTO rate_limits (
                    client_key,
                    action,
                    count,
                    window_start,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(client_key, action) DO UPDATE SET
                    count = excluded.count,
                    window_start = excluded.window_start,
                    updated_at = excluded.updated_at
                """,
                (
                    client_key,
                    action,
                    used,
                    _to_iso(window_start),
                    _to_iso(now),
                ),
            )
            return RateLimitResult(
                allowed=True,
                item=_build_item(action, safe_limit, used, window_start),
            )

        window_start = _parse_iso(str(row["window_start"]), now)
        current_count = int(row["count"])
        if current_count >= safe_limit:
            return RateLimitResult(
                allowed=False,
                item=_build_item(action, safe_limit, current_count, window_start),
            )

        used = current_count + 1
        connection.execute(
            """
            UPDATE rate_limits
            SET count = ?,
                updated_at = ?
            WHERE client_key = ? AND action = ?
            """,
            (used, _to_iso(now), client_key, action),
        )

    return RateLimitResult(
        allowed=True,
        item=_build_item(action, safe_limit, used, window_start),
    )


def get_rate_limit_items(
    client_key: str,
    action_limits: dict[str, int],
) -> list[RateLimitItem]:
    """
    读取当前客户端的本地频控状态。
    """
    now = datetime.now(UTC)
    with _connect() as connection:
        _ensure_schema(connection)
        rows = {
            str(row["action"]): row
            for row in connection.execute(
                """
                SELECT action, count, window_start
                FROM rate_limits
                WHERE client_key = ?
                """,
                (client_key,),
            ).fetchall()
        }

    items: list[RateLimitItem] = []
    for action, limit in action_limits.items():
        row = rows.get(action)
        if row is None or _is_expired(str(row["window_start"]), now):
            items.append(_build_item(action, max(1, limit), 0, now))
            continue

        items.append(
            _build_item(
                action,
                max(1, limit),
                int(row["count"]),
                _parse_iso(str(row["window_start"]), now),
            )
        )

    return items


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS rate_limits (
            client_key TEXT NOT NULL,
            action TEXT NOT NULL,
            count INTEGER NOT NULL,
            window_start TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (client_key, action)
        )
        """
    )


def _build_item(
    action: str,
    limit: int,
    used: int,
    window_start: datetime,
) -> RateLimitItem:
    reset_at = window_start + timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS)
    normalized_used = min(max(0, used), limit)
    return RateLimitItem(
        action=action,
        limit=limit,
        used=normalized_used,
        remaining=max(0, limit - normalized_used),
        reset_at=_to_iso(reset_at),
    )


def _is_expired(window_start: str, now: datetime) -> bool:
    started_at = _parse_iso(window_start, now)
    return now >= started_at + timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS)


def _parse_iso(value: str, fallback: datetime) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return fallback

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)

    return parsed.astimezone(UTC)


def _to_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds")
