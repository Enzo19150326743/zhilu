import unittest

from app.schemas import (
    NoteDraft,
    ParseResponse,
    SummaryHighlight,
    TimelineItem,
    TranscriptPayload,
    TranscriptSegment,
    VideoInfo,
    VideoSummary,
)
from app.services.obsidian_export_service import build_obsidian_markdown


class ObsidianExportServiceTests(unittest.TestCase):
    def test_confirmed_quotes_and_ai_candidates_are_exported_separately(self) -> None:
        """
        用户确认摘录优先作为正式摘录，AI 候选必须单独标记为未确认。
        """
        ai_candidate_text = "这是一条 AI 提取的摘录。"
        confirmed_text = "这是一条用户确认加入草稿的摘录。"
        detail = _build_parse_response(
            summary_highlights=[
                SummaryHighlight(
                    id="ai-candidate-1",
                    text=ai_candidate_text,
                    reason="适合作为候选",
                    source="ai",
                )
            ],
            note_draft=NoteDraft(
                highlights=[
                    SummaryHighlight(
                        id="manual-1",
                        text=confirmed_text,
                        source="manual",
                        source_type="subtitle",
                    )
                ]
            ),
        )

        markdown = build_obsidian_markdown(detail)

        self.assertIn("## 可靠原文摘录", markdown)
        self.assertIn("> [!quote] 用户确认摘录", markdown)
        self.assertIn(confirmed_text, markdown)
        self.assertIn("## AI 候选摘录（未确认）", markdown)
        self.assertIn("> [!quote] AI 候选摘录", markdown)
        self.assertIn(ai_candidate_text, markdown)

    def test_ai_candidates_never_look_like_confirmed_quotes(self) -> None:
        """
        没有摘录草稿时，AI 候选仍可展示，但不能伪装成用户确认摘录。
        """
        ai_candidate_text = "这是一条尚未确认的 AI 候选。"
        detail = _build_parse_response(
            summary_highlights=[
                SummaryHighlight(
                    id="ai-candidate-1",
                    text=ai_candidate_text,
                    source="ai",
                )
            ],
            note_draft=None,
        )

        markdown = build_obsidian_markdown(detail)

        self.assertIn("暂无用户确认摘录", markdown)
        self.assertIn("## AI 候选摘录（未确认）", markdown)
        self.assertIn(ai_candidate_text, markdown)
        self.assertNotIn("> [!quote] 用户确认摘录\n> “这是一条尚未确认", markdown)

    def test_export_uses_universal_knowledge_draft_contract(self) -> None:
        """
        通用 YAML 覆盖稳定元数据，不输出个人知识库字段。
        """
        detail = _build_parse_response(summary_highlights=[], note_draft=None)

        markdown = build_obsidian_markdown(detail)

        self.assertIn('草稿版本: "1.0"', markdown)
        self.assertIn('标题: "示例内容"', markdown)
        self.assertIn('内容类型: "视频"', markdown)
        self.assertIn('平台: "example"', markdown)
        self.assertIn('原始作者: "示例作者"', markdown)
        self.assertIn('源链接: "https://example.com/video"', markdown)
        self.assertIn("处理日期:", markdown)
        self.assertIn("内容关键词:", markdown)
        self.assertIn('  - "示例"', markdown)
        self.assertIn("时长（秒）: 120", markdown)
        self.assertNotIn("tags:", markdown)
        self.assertNotIn("用途:", markdown)
        self.assertNotIn("主题:", markdown)
        self.assertNotIn("入库日期:", markdown)
        self.assertNotIn("稳定双链", markdown)
        self.assertNotIn("text_source_type:", markdown)
        self.assertNotIn("[[价值观档案]]", markdown)
        self.assertNotIn("[[表达风格档案]]", markdown)
        self.assertNotIn("对我的可能启发", markdown)
        self.assertNotIn("为什么值得入库", markdown)

    def test_markdown_contains_generic_sections_and_no_full_text_or_timeline(self) -> None:
        """
        通用正文保留结构、应用线索和边界，但不附完整逐字稿或不可靠时间点。
        """
        detail = _build_parse_response(summary_highlights=[], note_draft=None)

        markdown = build_obsidian_markdown(detail, include_full_text=True)

        self.assertIn("## 一句话摘要", markdown)
        self.assertIn("## 内容结构", markdown)
        self.assertIn("## 核心观点", markdown)
        self.assertIn("## 通用应用线索", markdown)
        self.assertIn("## 内容边界与待核实信息", markdown)
        self.assertIn("ASR 可能存在识别误差", markdown)
        self.assertNotIn("## 压缩时间轴", markdown)
        self.assertNotIn("## 完整原文附录", markdown)
        self.assertIn("完整原文仍保存在知录本地记录中", markdown)
        self.assertNotIn("00:00", markdown)


def _build_parse_response(
    summary_highlights: list[SummaryHighlight],
    note_draft: NoteDraft | None,
) -> ParseResponse:
    return ParseResponse(
        source_url="https://example.com/video",
        video=VideoInfo(
            video_id="video_001",
            platform="example",
            url="https://example.com/video",
            title="示例内容",
            author="示例作者",
            duration=120,
            thumbnail="",
            has_transcript=True,
            media_type="video",
            text_source_type="asr_transcript",
        ),
        formats=[],
        transcript=TranscriptPayload(
            segments=[TranscriptSegment(start=0, end=2, text="示例原文。")],
            plain_text="示例原文。",
        ),
        summary=VideoSummary(
            draft_version="1.0",
            content_type="视频",
            topics=["示例", "知识整理"],
            tldr="一句话摘要",
            key_points=["核心要点"],
            timeline=[TimelineItem(time="00:00", content="开场")],
            structured_analysis_markdown="## 结构化总结",
            takeaways=["行动建议"],
            highlights=summary_highlights,
            content_keywords=["示例", "知识整理"],
            application_clues=["可用于快速复习核心要点。"],
            content_boundaries=["ASR 可能存在识别误差，专有名词需要复核。"],
            # 旧个人化字段故意保留，用于确认通用导出不会继续消费它们。
            reason_for_saving="这条内容可能值得作为外部输入草稿。",
            personal_relevance=["可能关联用户的选题素材，待确认。"],
            transformation_ideas=["可以改写成一个短视频选题。"],
            search_keywords=["示例", "外部输入"],
            related_wikilinks=["外部输入", "表达风格档案"],
            to_confirm=["是否吸收为长期观点需要后续确认。"],
        ),
        mindmap_markdown="# 示例内容",
        note_draft=note_draft,
    )
