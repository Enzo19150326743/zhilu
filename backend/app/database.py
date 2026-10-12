"""SQLite 连接与事务边界；表结构仍由所属业务维护。"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal


@contextmanager
def connect_database(
    database_path: Path,
    *,
    transaction: Literal["deferred", "immediate", "implicit"] = "deferred",
    foreign_keys: bool = False,
) -> Iterator[sqlite3.Connection]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(
        database_path,
        timeout=5,
        isolation_level="" if transaction == "implicit" else None,
    )
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA busy_timeout = 5000")
        if foreign_keys:
            connection.execute("PRAGMA foreign_keys = ON")
        if transaction != "implicit":
            # 读后写操作先取写锁，避免长稿保存时发生读锁升级冲突。
            connection.execute("BEGIN IMMEDIATE" if transaction == "immediate" else "BEGIN")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
