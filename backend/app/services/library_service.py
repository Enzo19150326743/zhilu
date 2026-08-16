import json
import logging
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from app.schemas import (
    LibraryItem,
    LibraryStatsResponse,
    NoteDraft,
    ParseResponse,
    SummaryHighlight,
    ShownotesContext,
    SummarizeResponse,
    TranscriptSegment,
    TranscriptPayload,
)
from app.services.text_normalization_service import simplify_text_payload

logger = logging.getLogger(__name__)

DATABASE_PATH = Path(__file__).resolve().parents[2] / "data" / "local_library.sqlite3"
DEFAULT_LIBRARY_LIMIT = 8
MAX_LIBRARY_LIMIT = 50
BILIBILI_BVID_PATTERN = re.compile(r"(BV[a-zA-Z0-9]+)")
LibraryFilter = Literal["all", "ready", "summarized", "noTranscript"]


def upsert_library_item(parse_response: ParseResponse) -> None:
    """
    保存完整解析结果。

    NOTE: V0.2 先用单表 JSON 快速形成内容库闭环，后续搜索和 QA 再拆分字幕表。
    """
    payload = simplify_text_payload(parse_response.model_dump(mode="json"))
    timestamp = _get_now_iso()
    with _connect() as connection:
        _ensure_schema(connection)
        connection.execute(
            """
            INSERT INTO library_items (
                source_url,
                video_id,
                title,
                author,
                platform,
                thumbnail,
                duration,
                has_transcript,
                summary_status,
                summary_model,
                payload_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
                video_id = excluded.video_id,
                title = excluded.title,
                author = excluded.author,
                platform = excluded.platform,
                thumbnail = excluded.thumbnail,
                duration = excluded.duration,
                has_transcript = excluded.has_transcript,
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            """,
            (
                parse_response.source_url,
                parse_response.video.video_id,
                parse_response.video.title,
                parse_response.video.author,
                parse_response.video.platform,
                parse_response.video.thumbnail,
                parse_response.video.duration,
                int(parse_response.video.has_transcript),
                "none",
                None,
                json.dumps(payload, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )


def update_summary_for_source_url(
    source_url: str | None,
    summarize_response: SummarizeResponse,
) -> None:
    """
    将总结结果写回对应解析记录；没有历史记录时保持静默。
    """
    if not source_url:
        return

    with _connect() as connection:
        _ensure_schema(connection)
        row = _find_library_row_for_source_url(connection, source_url)
        if row is None:
            logger.info("library item not found for summary update")
            return

        if (
            row["summary_status"] == "ai_generated"
            and not summarize_response.is_ai_generated
        ):
            logger.info("skip local fallback summary overwrite for ai-generated item")
            return

        payload = json.loads(str(row["payload_json"]))
        payload["summary"] = summarize_response.summary.model_dump(mode="json")
        payload["mindmap_markdown"] = summarize_response.mindmap_markdown
        payload["mindmap_meta"] = (
            summarize_response.mindmap_meta.model_dump(mode="json")
            if summarize_response.mindmap_meta
            else None
        )
        # NOTE: 保留降级原因，便于事后排查偶发失败，不写入前端展示字段。
        payload["summary_fallback_reason"] = summarize_response.fallback_reason
        summary_status = (
            "ai_generated" if summarize_response.is_ai_generated else "local_fallback"
        )
        connection.execute(
            """
            UPDATE library_items
            SET summary_status = ?,
                summary_model = ?,
                payload_json = ?,
                updated_at = ?
            WHERE source_url = ?
            """,
            (
                summary_status,
                summarize_response.model,
                json.dumps(payload, ensure_ascii=False),
                _get_now_iso(),
                str(row["source_url"]),
            ),
        )


def update_transcript_for_source_url(
    source_url: str | None,
    transcript: TranscriptPayload,
    transcript_variant_key: str | None = None,
    shownotes_context: ShownotesContext | None = None,
) -> None:
    """
    将本地 ASR 生成的内容文本写回对应解析记录；没有历史记录时保持静默。

    NOTE: 内容文本来源变成 AI 转写稿后，旧总结和导图不再可信，必须失效后重新生成。
    """
    if not source_url:
        return

    with _connect() as connection:
        _ensure_schema(connection)
        row = _find_library_row_for_source_url(connection, source_url)
        if row is None:
            logger.info("library item not found for transcript update")
            return

        payload = json.loads(str(row["payload_json"]))
        video = payload.get("video")
        if not isinstance(video, dict):
            logger.info("library payload missing video for transcript update")
            return

        had_shownotes_source = video.get("text_source_type") == "shownotes"
        video["has_transcript"] = True
        video["text_source_type"] = "asr_transcript"
        if not video.get("media_type"):
            video["media_type"] = "video"

        payload["video"] = video
        if not payload.get("shownotes_plain_text") and had_shownotes_source:
            legacy_shownotes = payload.get("transcript")
            if isinstance(legacy_shownotes, dict):
                legacy_text = legacy_shownotes.get("plain_text")
                if isinstance(legacy_text, str) and legacy_text.strip():
                    payload["shownotes_plain_text"] = legacy_text.strip()
        if shownotes_context is not None:
            payload["shownotes_context"] = shownotes_context.model_dump(mode="json")
        existing_transcript = payload.get("transcript")
        transcript_variants = payload.get("transcript_variants")
        if not isinstance(transcript_variants, dict):
            transcript_variants = {}

        # 旧历史只有一个 transcript；首次重转写时先把它迁移到对应引擎键下。
        if not transcript_variants and isinstance(existing_transcript, dict):
            try:
                legacy_transcript = TranscriptPayload.model_validate(existing_transcript)
            except ValueError:
                legacy_transcript = None
            if legacy_transcript and legacy_transcript.asr_meta:
                legacy_key = _get_transcript_variant_key(legacy_transcript)
                transcript_variants[legacy_key] = legacy_transcript.model_dump(mode="json")

        active_variant_key = (
            transcript_variant_key.strip()
            if isinstance(transcript_variant_key, str) and transcript_variant_key.strip()
            else _get_transcript_variant_key(transcript)
        )
        serialized_transcript = transcript.model_dump(mode="json")
        transcript_variants[active_variant_key] = serialized_transcript
        payload["transcript"] = serialized_transcript
        payload["transcript_variants"] = transcript_variants
        payload["active_transcript_variant"] = active_variant_key
        payload["summary"] = _build_transcript_update_summary_placeholder(video)
        payload["mindmap_markdown"] = _build_transcript_update_mindmap_placeholder(
            video
        )
        payload["mindmap_meta"] = None
        payload = simplify_text_payload(payload)
        connection.execute(
            """
            UPDATE library_items
            SET has_transcript = ?,
                summary_status = ?,
                summary_model = ?,
                payload_json = ?,
                updated_at = ?
            WHERE source_url = ?
            """,
            (
                1,
                "none",
                None,
                json.dumps(payload, ensure_ascii=False),
                _get_now_iso(),
                str(row["source_url"]),
            ),
        )


def _get_transcript_variant_key(transcript: TranscriptPayload) -> str:
    engine = (
        transcript.asr_meta.engine.strip().lower()
        if transcript.asr_meta and transcript.asr_meta.engine
        else ""
    )
    if engine in {"faster-whisper", "whisper", "local_whisper"}:
        return "local_whisper"
    if engine in {"sensevoice", "sensevoice-small", "sensevoice_small"}:
        return "sensevoice_small"
    return engine or "local_whisper"


def update_note_draft_for_source_url(
    source_url: str | None,
    note_draft: NoteDraft,
) -> NoteDraft | None:
    """
    将摘录草稿写回解析记录的 payload_json.note_draft；没有历史记录时返回 None。
    """
    if not source_url:
        return None

    with _connect() as connection:
        _ensure_schema(connection)
        row = _find_library_row_for_source_url(connection, source_url)
        if row is None:
            logger.info("library item not found for note draft update")
            return None

        payload = json.loads(str(row["payload_json"]))
        payload["note_draft"] = note_draft.model_dump(mode="json")
        payload = simplify_text_payload(payload)
        persisted_note_draft = NoteDraft.model_validate(payload["note_draft"])
        connection.execute(
            """
            UPDATE library_items
            SET payload_json = ?,
                updated_at = ?
            WHERE source_url = ?
            """,
            (
                json.dumps(payload, ensure_ascii=False),
                _get_now_iso(),
                str(row["source_url"]),
            ),
        )

    return persisted_note_draft


def _build_transcript_update_summary_placeholder(
    video: dict[str, Any],
) -> dict[str, Any]:
    title = _optional_text(video.get("title")) or "当前媒体内容"
    return {
        "tldr": "AI 转写稿已生成，可基于新的内容文本重新生成结构化总结。",
        "key_points": [
            f"《{title}》已写入新的 AI 转写稿。",
            "旧总结可能基于平台字幕或 shownotes，当前已重置为待重新生成状态。",
            "请重新生成总结后再查看摘录和导图。",
        ],
        "timeline": [],
        "structured_analysis_markdown": (
            f"## {title}\n"
            "### 当前状态\n"
            "AI 转写稿已生成，旧总结和导图已失效。\n"
            "### 下一步\n"
            "基于新的 AI 转写稿重新生成结构化总结。"
        ),
        "takeaways": [
            "重新生成总结可以避免 shownotes、平台字幕和 AI 转写稿之间的来源混淆。",
            "专有名词、人名和断句仍建议结合原媒体复核。",
        ],
    }


def _build_transcript_update_mindmap_placeholder(video: dict[str, Any]) -> str:
    title = _optional_text(video.get("title")) or "当前媒体内容"
    return (
        f"# {title}\n"
        "## 当前状态\n"
        "### AI 转写稿已生成\n"
        "### 旧导图已重置\n"
        "## 下一步\n"
        "### 基于 AI 转写稿重新生成总结和导图"
    )


def list_recent_library_items(
    limit: int = DEFAULT_LIBRARY_LIMIT,
    library_filter: LibraryFilter = "all",
) -> list[LibraryItem]:
    """
    返回最近更新的本地解析记录。
    """
    normalized_limit = max(1, min(limit, MAX_LIBRARY_LIMIT))
    filter_clauses = {
        "all": "1 = 1",
        "ready": """
            has_transcript = 1
            AND COALESCE(
                CASE WHEN json_valid(payload_json)
                    THEN json_extract(payload_json, '$.video.text_source_type')
                END,
                ''
            ) != 'shownotes'
            AND summary_status NOT IN ('ai_generated', 'local_fallback')
        """,
        "summarized": """
            has_transcript = 1
            AND COALESCE(
                CASE WHEN json_valid(payload_json)
                    THEN json_extract(payload_json, '$.video.text_source_type')
                END,
                ''
            ) != 'shownotes'
            AND summary_status IN ('ai_generated', 'local_fallback')
        """,
        "noTranscript": """
            has_transcript = 0
            OR COALESCE(
                CASE WHEN json_valid(payload_json)
                    THEN json_extract(payload_json, '$.video.text_source_type')
                END,
                ''
            ) = 'shownotes'
        """,
    }
    filter_clause = filter_clauses[library_filter]
    with _connect() as connection:
        _ensure_schema(connection)
        rows = connection.execute(
            f"""
            SELECT video_id,
                   source_url,
                   title,
                   author,
                   platform,
                   thumbnail,
                   duration,
                   has_transcript,
                   summary_status,
                   summary_model,
                   payload_json,
                   updated_at
            FROM library_items
            WHERE {filter_clause}
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (normalized_limit,),
        ).fetchall()

    return [_row_to_library_item(row) for row in rows]


def get_library_stats() -> LibraryStatsResponse:
    """
    返回本地内容库统计信息。
    """
    with _connect() as connection:
        _ensure_schema(connection)
        row = connection.execute(
            """
            SELECT COUNT(*) AS total_items,
                   SUM(CASE WHEN has_transcript = 1 THEN 1 ELSE 0 END)
                       AS with_transcript_count,
                   SUM(CASE WHEN has_transcript = 0 THEN 1 ELSE 0 END)
                       AS no_transcript_count,
                   SUM(CASE WHEN has_transcript = 1
                       AND COALESCE(
                           CASE WHEN json_valid(payload_json)
                               THEN json_extract(payload_json, '$.video.text_source_type')
                           END,
                           ''
                       ) != 'shownotes'
                       AND summary_status IN ('ai_generated', 'local_fallback')
                       THEN 1 ELSE 0 END) AS summarized_count,
                   SUM(CASE WHEN summary_status = 'ai_generated' THEN 1 ELSE 0 END)
                       AS ai_summary_count,
                   SUM(CASE WHEN summary_status = 'local_fallback' THEN 1 ELSE 0 END)
                       AS fallback_summary_count,
                   SUM(CASE WHEN has_transcript = 1
                       AND COALESCE(
                           CASE WHEN json_valid(payload_json)
                               THEN json_extract(payload_json, '$.video.text_source_type')
                           END,
                           ''
                       ) != 'shownotes'
                       AND summary_status NOT IN ('ai_generated', 'local_fallback')
                       THEN 1 ELSE 0 END) AS ready_count,
                   SUM(CASE WHEN has_transcript = 0
                       OR COALESCE(
                           CASE WHEN json_valid(payload_json)
                               THEN json_extract(payload_json, '$.video.text_source_type')
                           END,
                           ''
                       ) = 'shownotes'
                       THEN 1 ELSE 0 END) AS needs_transcript_count
            FROM library_items
            """
        ).fetchone()

    return LibraryStatsResponse(
        total_items=_row_int(row, "total_items"),
        with_transcript_count=_row_int(row, "with_transcript_count"),
        no_transcript_count=_row_int(row, "no_transcript_count"),
        summarized_count=_row_int(row, "summarized_count"),
        ai_summary_count=_row_int(row, "ai_summary_count"),
        fallback_summary_count=_row_int(row, "fallback_summary_count"),
        ready_count=_row_int(row, "ready_count"),
        needs_transcript_count=_row_int(row, "needs_transcript_count"),
    )


def get_library_detail(video_id: str) -> ParseResponse | None:
    """
    根据 video_id 读取完整工作台数据。
    """
    with _connect() as connection:
        _ensure_schema(connection)
        row = connection.execute(
            """
            SELECT source_url, payload_json, summary_status, summary_model
            FROM library_items
            WHERE video_id = ?
            """,
            (video_id,),
        ).fetchone()

    if row is None:
        return None

    return _row_to_parse_response(row)


def get_library_detail_by_source_url(source_url: str) -> ParseResponse | None:
    """
    根据 URL 读取完整工作台数据，用于避免重复解析同一公开视频。
    """
    with _connect() as connection:
        _ensure_schema(connection)
        row = _find_library_row_for_source_url(connection, source_url)

    if row is None:
        return None

    return _row_to_parse_response(row)


def _find_library_row_for_source_url(
    connection: sqlite3.Connection,
    source_url: str,
) -> sqlite3.Row | None:
    """
    B 站链接经常携带跟踪 query；精确 URL 未命中时按 BVID 兜底复用同一视频历史。
    """
    row = connection.execute(
        """
        SELECT source_url, payload_json, summary_status, summary_model
        FROM library_items
        WHERE source_url = ?
        """,
        (source_url,),
    ).fetchone()
    if row is not None:
        return row

    video_id = _extract_bilibili_video_id(source_url)
    if video_id is None:
        return None

    return connection.execute(
        """
        SELECT source_url, payload_json, summary_status, summary_model
        FROM library_items
        WHERE video_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (video_id,),
    ).fetchone()


def _extract_bilibili_video_id(source_url: str) -> str | None:
    match = BILIBILI_BVID_PATTERN.search(source_url)
    return match.group(1) if match else None


def delete_library_item(video_id: str) -> bool:
    """
    删除单条本地历史记录。
    """
    with _connect() as connection:
        _ensure_schema(connection)
        cursor = connection.execute(
            "DELETE FROM library_items WHERE video_id = ?",
            (video_id,),
        )
        deleted_count = cursor.rowcount

    return deleted_count > 0


def clear_library_items() -> int:
    """
    清空本地内容库历史记录。
    """
    with _connect() as connection:
        _ensure_schema(connection)
        cursor = connection.execute("DELETE FROM library_items")
        deleted_count = cursor.rowcount

    return max(0, deleted_count)


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
        CREATE TABLE IF NOT EXISTS library_items (
            source_url TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            platform TEXT NOT NULL,
            thumbnail TEXT NOT NULL,
            duration INTEGER NOT NULL,
            has_transcript INTEGER NOT NULL,
            summary_status TEXT NOT NULL,
            summary_model TEXT,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    _ensure_optional_column(
        connection,
        table_name="library_items",
        column_name="summary_model",
        column_definition="summary_model TEXT",
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_items_video_id ON library_items(video_id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_items_updated_at ON library_items(updated_at)"
    )


def _ensure_optional_column(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    columns = {
        str(row["name"])
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_definition}")


def _row_to_library_item(row: sqlite3.Row) -> LibraryItem:
    media_type, text_source_type = _extract_media_metadata(row["payload_json"])

    return LibraryItem(
        video_id=str(row["video_id"]),
        source_url=str(row["source_url"]),
        title=str(row["title"]),
        author=str(row["author"]),
        platform=str(row["platform"]),
        thumbnail=str(row["thumbnail"]),
        duration=int(row["duration"]),
        has_transcript=bool(row["has_transcript"]),
        summary_status=str(row["summary_status"]),
        summary_model=(
            str(row["summary_model"]) if row["summary_model"] is not None else None
        ),
        media_type=media_type,
        text_source_type=text_source_type,
        updated_at=str(row["updated_at"]),
    )


def _extract_media_metadata(payload_json: Any) -> tuple[str | None, str | None]:
    try:
        payload = json.loads(str(payload_json))
    except (json.JSONDecodeError, TypeError):
        logger.debug("failed to parse library payload metadata")
        return None, None

    if not isinstance(payload, dict):
        return None, None

    video = payload.get("video")
    if not isinstance(video, dict):
        return None, None

    return _optional_text(video.get("media_type")), _optional_text(
        video.get("text_source_type")
    )


def _optional_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return None


def _row_int(row: sqlite3.Row | None, column_name: str) -> int:
    if row is None or row[column_name] is None:
        return 0

    return int(row[column_name])


def _row_to_parse_response(row: sqlite3.Row) -> ParseResponse:
    raw_payload_json = str(row["payload_json"])
    payload = json.loads(raw_payload_json)
    simplified_payload = simplify_text_payload(payload)
    if simplified_payload != payload:
        _persist_simplified_payload(str(row["source_url"]), simplified_payload)
        payload = simplified_payload

    parse_response = _with_summary_highlight_fallbacks(
        ParseResponse.model_validate(payload)
    )
    return parse_response.model_copy(
        update={
            "is_from_cache": True,
            "library_summary_status": str(row["summary_status"]),
            "library_summary_model": (
                str(row["summary_model"]) if row["summary_model"] is not None else None
            ),
        }
    )


def _with_summary_highlight_fallbacks(parse_response: ParseResponse) -> ParseResponse:
    """
    旧历史总结可能没有 highlights；读取时补基础摘录，避免摘录工作流空转。
    """
    if parse_response.summary.highlights:
        return parse_response

    fallback_highlights = _build_note_candidate_fallbacks(parse_response)
    if not fallback_highlights:
        return parse_response

    return parse_response.model_copy(
        update={
            "summary": parse_response.summary.model_copy(
                update={"highlights": fallback_highlights}
            )
        }
    )


def _build_note_candidate_fallbacks(
    parse_response: ParseResponse,
) -> list[SummaryHighlight]:
    source_type = parse_response.video.text_source_type or "transcript"
    timed_segments = _select_evenly_spaced_segments(
        _get_candidate_segments(parse_response.transcript.segments),
        3,
    )
    if timed_segments:
        return [
            SummaryHighlight(
                id=f"local-{index:03d}",
                text=_trim_text(segment.text, 500),
                start=segment.start,
                end=segment.end,
                reason="基础候选从内容文本片段中提取，建议人工复核。",
                tags=["摘录"],
                source="local_fallback",
                source_type=source_type,
            )
            for index, segment in enumerate(timed_segments, start=1)
            if segment.text.strip()
        ]

    snippets = _extract_note_snippets(parse_response.transcript.plain_text)
    return [
        SummaryHighlight(
            id=f"local-{index:03d}",
            text=_trim_text(snippet, 500),
            start=None,
            end=None,
            reason="基础候选从内容文本中提取，建议人工复核。",
            tags=["摘录"],
            source="local_fallback",
            source_type=source_type,
        )
        for index, snippet in enumerate(snippets[:3], start=1)
        if snippet.strip()
    ]


def _get_candidate_segments(
    segments: list[TranscriptSegment],
) -> list[TranscriptSegment]:
    return [segment for segment in segments if segment.text.strip()]


def _select_evenly_spaced_segments(
    segments: list[TranscriptSegment],
    max_items: int,
) -> list[TranscriptSegment]:
    if len(segments) <= max_items:
        return segments

    last_index = len(segments) - 1
    selected_indexes = {
        round(index * last_index / (max_items - 1)) for index in range(max_items)
    }
    return [segments[index] for index in sorted(selected_indexes)]


def _extract_note_snippets(text: str) -> list[str]:
    normalized_text = re.sub(r"\s+", " ", text).strip()
    if not normalized_text:
        return []

    snippets = [
        snippet.strip()
        for snippet in re.split(r"(?<=[。！？.!?])\s+", normalized_text)
        if snippet.strip()
    ]
    if len(snippets) <= 1:
        snippets = [
            normalized_text[index : index + 120].strip()
            for index in range(0, min(len(normalized_text), 360), 120)
        ]

    return snippets[:3]


def _trim_text(text: str, max_length: int) -> str:
    normalized_text = re.sub(r"\s+", " ", text).strip()
    if len(normalized_text) <= max_length:
        return normalized_text

    return f"{normalized_text[:max_length].rstrip()}..."


def _persist_simplified_payload(source_url: str, payload: dict[str, Any]) -> None:
    """
    旧记录可能已经落入繁体文本；读取时顺手修正本地库，避免下次仍然返回繁体。
    """
    try:
        with _connect() as connection:
            _ensure_schema(connection)
            connection.execute(
                """
                UPDATE library_items
                SET payload_json = ?,
                    updated_at = ?
                WHERE source_url = ?
                """,
                (
                    json.dumps(payload, ensure_ascii=False),
                    _get_now_iso(),
                    source_url,
                ),
            )
    except (sqlite3.Error, OSError, ValueError) as error:
        logger.warning(
            "library simplified payload persist failed: %s",
            error.__class__.__name__,
        )


def _get_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
