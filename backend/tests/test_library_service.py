import json
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from app.schemas import (
    MindmapMeta,
    ParseResponse,
    ShownotesContext,
    ShownotesSpeaker,
    TranscribeSpeakerProfile,
    SummarizeResponse,
    TranscriptAsrMeta,
    TranscriptPayload,
    TranscriptSegment,
    VideoInfo,
    VideoSummary,
)
from app.services import library_service


class LibraryServiceTests(unittest.TestCase):
    def test_recent_items_filter_uses_full_library_before_limit(self) -> None:
        """筛选必须先作用于完整内容库，再按当前页面数量截取。"""
        with self._temporary_library():
            summarized = _build_parse_response(
                media_type="video",
                text_source_type="subtitle",
            )
            summarized.video.video_id = "summarized_001"
            summarized.video.url = "https://example.com/summarized"
            summarized.source_url = summarized.video.url
            library_service.upsert_library_item(summarized)
            with library_service._connect() as connection:
                connection.execute(
                    "UPDATE library_items SET summary_status = 'ai_generated' WHERE video_id = ?",
                    (summarized.video.video_id,),
                )

            needs_transcript = _build_parse_response(
                media_type="podcast",
                text_source_type="shownotes",
            )
            needs_transcript.video.video_id = "shownotes_001"
            needs_transcript.video.url = "https://example.com/shownotes"
            needs_transcript.source_url = needs_transcript.video.url
            library_service.upsert_library_item(needs_transcript)

            items = library_service.list_recent_library_items(
                limit=1,
                library_filter="summarized",
            )
            stats = library_service.get_library_stats()

        self.assertEqual([item.video_id for item in items], ["summarized_001"])
        self.assertEqual(stats.summarized_count, 1)
        self.assertEqual(stats.needs_transcript_count, 1)

    def test_recent_items_include_media_metadata_from_payload(self) -> None:
        """
        最近解析列表需要透传媒体类型，让前端不再只依赖 platform 判断展示语境。
        """
        with self._temporary_library():
            library_service.upsert_library_item(
                _build_parse_response(
                    media_type="podcast",
                    text_source_type="shownotes",
                )
            )

            items = library_service.list_recent_library_items()

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].media_type, "podcast")
        self.assertEqual(items[0].text_source_type, "shownotes")

    def test_recent_items_keep_legacy_payload_compatible(self) -> None:
        """
        本地库历史记录可能缺少 V0.2.3 媒体字段，列表读取必须保持向后兼容。
        """
        with self._temporary_library():
            with library_service._connect() as connection:
                library_service._ensure_schema(connection)
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
                    """,
                    (
                        "https://example.com/legacy",
                        "legacy_001",
                        "旧记录",
                        "示例作者",
                        "bilibili",
                        "",
                        120,
                        1,
                        "none",
                        None,
                        "not-json",
                        "2026-05-15T00:00:00+00:00",
                        "2026-05-15T00:00:00+00:00",
                    ),
                )

            items = library_service.list_recent_library_items()

        self.assertEqual(len(items), 1)
        self.assertIsNone(items[0].media_type)
        self.assertIsNone(items[0].text_source_type)

    def test_legacy_summary_without_universal_fields_uses_defaults(self) -> None:
        """
        旧 SQLite JSON 缺少通用草稿字段时仍可打开，并明确标记为 legacy。
        """
        with self._temporary_library():
            legacy_payload = _build_parse_response(
                media_type="video",
                text_source_type="subtitle",
            ).model_dump(mode="json")
            legacy_summary = legacy_payload["summary"]
            for field_name in (
                "draft_version",
                "content_keywords",
                "application_clues",
                "content_boundaries",
            ):
                legacy_summary.pop(field_name, None)

            with library_service._connect() as connection:
                library_service._ensure_schema(connection)
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
                    """,
                    (
                        "https://example.com/podcast",
                        "podcast_001",
                        "旧通用草稿记录",
                        "示例作者",
                        "example",
                        "",
                        120,
                        1,
                        "ai_generated",
                        "legacy-model",
                        json.dumps(legacy_payload, ensure_ascii=False),
                        "2026-06-01T00:00:00+00:00",
                        "2026-06-01T00:00:00+00:00",
                    ),
                )

            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertEqual(detail.summary.draft_version, "legacy")
        self.assertEqual(detail.summary.content_keywords, [])
        self.assertEqual(detail.summary.application_clues, [])
        self.assertEqual(detail.summary.content_boundaries, [])

    def test_summary_update_persists_mindmap_meta_in_payload(self) -> None:
        """
        总结写回历史记录时，需要把智能导图元数据一起写进 payload_json。
        """
        with self._temporary_library():
            library_service.upsert_library_item(
                _build_parse_response(
                    media_type="podcast",
                    text_source_type="shownotes",
                )
            )
            library_service.update_summary_for_source_url(
                "https://example.com/podcast",
                SummarizeResponse(
                    summary=VideoSummary(
                        tldr="新总结",
                        key_points=["观点"],
                        timeline=[],
                        structured_analysis_markdown="## 分析",
                        takeaways=["行动"],
                    ),
                    mindmap_markdown="# 新导图",
                    mindmap_meta=MindmapMeta(
                        layout="tree",
                        content_category="interview_podcast",
                        template_id="interview_podcast_tree",
                        media_type="podcast",
                        text_source_type="shownotes",
                    ),
                    is_ai_generated=True,
                    model="deepseek-test",
                ),
            )

            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertIsNotNone(detail.mindmap_meta)
        self.assertEqual(detail.mindmap_meta.content_category, "interview_podcast")
        self.assertEqual(detail.mindmap_meta.text_source_type, "shownotes")

    def test_transcript_update_persists_generated_text(self) -> None:
        """
        ASR 生成 AI 转写稿后，需要写回历史记录并解锁后续总结、导图和 QA。
        """
        with self._temporary_library():
            parse_response = _build_parse_response(
                media_type="video",
                text_source_type="transcript",
            )
            parse_response.video.has_transcript = False
            parse_response.transcript = TranscriptPayload(segments=[], plain_text="")
            library_service.upsert_library_item(parse_response)

            library_service.update_transcript_for_source_url(
                "https://example.com/podcast",
                TranscriptPayload(
                    segments=[
                        TranscriptSegment(
                            start=0,
                            end=2,
                            text="校对后的完整内容文本。",
                        )
                    ],
                    plain_text="校对后的完整内容文本。",
                    raw_segments=[
                        TranscriptSegment(
                            start=0,
                            end=2,
                            text="ASR 生成的完整内容文本。",
                        )
                    ],
                    raw_plain_text="ASR 生成的完整内容文本。",
                    asr_meta=TranscriptAsrMeta(
                        model="base",
                        device="cpu",
                        compute_type="int8",
                        language="zh",
                        correction_status="corrected",
                        correction_model="deepseek-v4-flash",
                        glossary_term_count=3,
                    ),
                ),
            )

            detail = library_service.get_library_detail("podcast_001")
            items = library_service.list_recent_library_items()

        self.assertIsNotNone(detail)
        self.assertTrue(detail.video.has_transcript)
        self.assertEqual(detail.video.text_source_type, "asr_transcript")
        self.assertEqual(detail.transcript.plain_text, "校对后的完整内容文本。")
        self.assertEqual(detail.transcript.raw_plain_text, "ASR 生成的完整内容文本。")
        self.assertIsNotNone(detail.transcript.asr_meta)
        self.assertEqual(detail.transcript.asr_meta.correction_status, "corrected")
        self.assertTrue(items[0].has_transcript)

    def test_transcript_update_keeps_independent_engine_variants(self) -> None:
        with self._temporary_library():
            parse_response = _build_parse_response(
                media_type="video",
                text_source_type="transcript",
            )
            parse_response.video.has_transcript = False
            parse_response.transcript = TranscriptPayload(segments=[], plain_text="")
            library_service.upsert_library_item(parse_response)

            whisper_transcript = _build_asr_transcript(
                text="Whisper 稿件。",
                engine="faster-whisper",
                model="large-v3-turbo",
            )
            sensevoice_transcript = _build_asr_transcript(
                text="SenseVoice 稿件。",
                engine="sensevoice-small",
                model="iic/SenseVoiceSmall",
            )
            library_service.update_transcript_for_source_url(
                "https://example.com/podcast",
                whisper_transcript,
                "local_whisper",
            )
            library_service.update_transcript_for_source_url(
                "https://example.com/podcast",
                sensevoice_transcript,
                "sensevoice_small",
            )

            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertEqual(detail.active_transcript_variant, "sensevoice_small")
        self.assertEqual(
            set(detail.transcript_variants),
            {"local_whisper", "sensevoice_small"},
        )
        self.assertEqual(detail.transcript.plain_text, "SenseVoice 稿件。")
        self.assertEqual(
            detail.transcript_variants["local_whisper"].plain_text,
            "Whisper 稿件。",
        )

    def test_transcript_update_persists_speaker_and_context_meta(self) -> None:
        """
        speaker 和转写设置都在 payload_json 内保存，不需要新增数据库表。
        """
        with self._temporary_library():
            library_service.upsert_library_item(
                _build_parse_response(
                    media_type="video",
                    text_source_type="transcript",
                )
            )

            library_service.update_transcript_for_source_url(
                "https://example.com/podcast",
                TranscriptPayload(
                    segments=[
                        TranscriptSegment(
                            start=0,
                            end=2,
                            speaker="主持人",
                            text="欢迎来到节目。",
                        )
                    ],
                    plain_text="主持人：欢迎来到节目。",
                    asr_meta=TranscriptAsrMeta(
                        model="base",
                        device="cpu",
                        compute_type="int8",
                        language="zh",
                        correction_status="corrected",
                        correction_model="deepseek-v4-flash",
                        glossary_term_count=1,
                        program_structure="interview",
                        content_tags=["ai_tech"],
                        speaker_profiles=[
                            TranscribeSpeakerProfile(name="主持人", role="主持人")
                        ],
                        speaker_label_status="inferred",
                    ),
                ),
            )

            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertEqual(detail.transcript.segments[0].speaker, "主持人")
        self.assertIsNotNone(detail.transcript.asr_meta)
        self.assertEqual(detail.transcript.asr_meta.program_structure, "interview")
        self.assertEqual(detail.transcript.asr_meta.content_tags, ["ai_tech"])
        self.assertEqual(detail.transcript.asr_meta.speaker_label_status, "inferred")

    def test_transcript_update_keeps_shownotes_and_context(self) -> None:
        with self._temporary_library():
            library_service.upsert_library_item(
                _build_parse_response(
                    media_type="podcast",
                    text_source_type="shownotes",
                )
            )
            shownotes_context = ShownotesContext(
                program_structure="interview",
                speakers=[ShownotesSpeaker(name="泓君", role="主持人", confidence="high")],
                terms=["FDE"],
            )
            library_service.update_transcript_for_source_url(
                "https://example.com/podcast",
                TranscriptPayload(segments=[], plain_text="完整转写稿。"),
                shownotes_context=shownotes_context,
            )
            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertEqual(detail.shownotes_plain_text, "Shownotes 第一段。\n\nShownotes 第二段。")
        self.assertEqual(detail.shownotes_context.speakers[0].name, "泓君")

    def test_transcript_update_invalidates_summary_from_previous_text(self) -> None:
        """
        内容文本切换为 AI 转写稿后，旧总结和导图必须失效，避免来源边界混淆。
        """
        with self._temporary_library():
            library_service.upsert_library_item(
                _build_parse_response(
                    media_type="podcast",
                    text_source_type="shownotes",
                )
            )
            library_service.update_summary_for_source_url(
                "https://example.com/podcast",
                SummarizeResponse(
                    summary=VideoSummary(
                        tldr="基于 shownotes 的旧总结",
                        key_points=["旧观点"],
                        timeline=[],
                        structured_analysis_markdown="## 旧分析",
                        takeaways=["旧行动"],
                    ),
                    mindmap_markdown="# 旧导图",
                    mindmap_meta=MindmapMeta(
                        layout="tree",
                        content_category="interview_podcast",
                        template_id="interview_podcast_tree",
                        media_type="podcast",
                        text_source_type="shownotes",
                    ),
                    is_ai_generated=True,
                    model="deepseek-test",
                ),
            )

            library_service.update_transcript_for_source_url(
                "https://example.com/podcast",
                TranscriptPayload(
                    segments=[],
                    plain_text="ASR 生成的 AI 转写稿。",
                ),
            )

            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertEqual(detail.library_summary_status, "none")
        self.assertIsNone(detail.library_summary_model)
        self.assertIsNone(detail.mindmap_meta)
        self.assertEqual(detail.video.text_source_type, "asr_transcript")
        self.assertIn("AI 转写稿已生成", detail.summary.tldr)
        self.assertIn("旧导图已重置", detail.mindmap_markdown)

    def test_library_detail_marks_cached_parse_response(self) -> None:
        """
        从历史库打开的解析结果应标记为缓存，前端才能提示重新解析可刷新高清格式。
        """
        with self._temporary_library():
            library_service.upsert_library_item(
                _build_parse_response(
                    media_type="video",
                    text_source_type="transcript",
                )
            )

            detail = library_service.get_library_detail("podcast_001")

        self.assertIsNotNone(detail)
        self.assertTrue(detail.is_from_cache)

    @contextmanager
    def _temporary_library(self) -> Iterator[Path]:
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "local_library.sqlite3"
            with patch.object(library_service, "DATABASE_PATH", database_path):
                yield database_path


def _build_parse_response(
    media_type: str | None,
    text_source_type: str | None,
) -> ParseResponse:
    return ParseResponse(
        source_url="https://example.com/podcast",
        is_placeholder=False,
        video=VideoInfo(
            video_id="podcast_001",
            platform="xiaoyuzhou",
            url="https://example.com/podcast",
            title="播客单集",
            author="示例播客",
            duration=1800,
            thumbnail="",
            has_transcript=True,
            media_type=media_type,
            text_source_type=text_source_type,
        ),
        formats=[],
        transcript=TranscriptPayload(
            segments=[],
            plain_text="Shownotes 第一段。\n\nShownotes 第二段。",
        ),
        summary=VideoSummary(
            tldr="示例总结",
            key_points=[],
            timeline=[],
            structured_analysis_markdown="",
            takeaways=[],
        ),
        mindmap_markdown="# 播客单集",
    )


def _build_asr_transcript(
    *,
    text: str,
    engine: str,
    model: str,
) -> TranscriptPayload:
    return TranscriptPayload(
        segments=[TranscriptSegment(start=0, end=2, text=text)],
        plain_text=text,
        raw_segments=[TranscriptSegment(start=0, end=2, text=text)],
        raw_plain_text=text,
        asr_meta=TranscriptAsrMeta(
            engine=engine,
            model=model,
            device="cpu",
            compute_type="test",
            correction_status="skipped",
        ),
    )


if __name__ == "__main__":
    unittest.main()
