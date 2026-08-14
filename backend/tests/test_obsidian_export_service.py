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
    def test_confirmed_quotes_exported_and_ai_candidates_excluded(self) -> None:
        """
        只有用户确认的摘录进入文档，未确认的 AI 候选摘录一律不导出。
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

        self.assertIn("## 原文摘录", markdown)
        self.assertIn("> [!quote] 原文金句", markdown)
        self.assertIn(confirmed_text, markdown)
        self.assertNotIn(ai_candidate_text, markdown)
        self.assertNotIn("## AI 候选摘录", markdown)

    def test_ai_candidates_are_excluded_without_confirmation(self) -> None:
        """
        没有确认任何摘录时，AI 候选不进入导出文档。
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

        self.assertIn("暂无原文金句", markdown)
        self.assertNotIn(ai_candidate_text, markdown)
        self.assertNotIn("## AI 候选摘录", markdown)

    def test_ai_quote_reason_split_into_lines_and_manual_has_no_reason(self) -> None:
        """
        AI 确认摘录的说明与应用场景分行输出；手动摘录不输出摘录说明。
        """
        detail = _build_parse_response(
            summary_highlights=[],
            note_draft=NoteDraft(
                highlights=[
                    SummaryHighlight(
                        id="ai-1",
                        text="AI 金句内容。",
                        reason="这句话很重要 可用场景：写作引用",
                        source="ai",
                    ),
                    SummaryHighlight(
                        id="manual-1",
                        text="手动摘录内容。",
                        source="manual",
                    ),
                ]
            ),
        )

        markdown = build_obsidian_markdown(detail)

        self.assertIn("- 摘录说明：这句话很重要", markdown)
        self.assertIn("- 应用场景：写作引用", markdown)
        self.assertIn("> “手动摘录内容。”", markdown)
        self.assertNotIn("用户手动加入摘录草稿", markdown)

    def test_content_structure_flat_and_hidden_when_empty(self) -> None:
        """
        结构化分析的 ## 小节平级输出，不包裹“内容结构”标题；为空时不输出。
        """
        detail = _build_parse_response(
            summary_highlights=[],
            note_draft=None,
        )

        markdown = build_obsidian_markdown(detail)

        self.assertNotIn("## 内容结构", markdown)
        self.assertIn("## 结构化总结", markdown)

        empty_detail = _build_parse_response(
            summary_highlights=[],
            note_draft=None,
        )
        empty_detail.summary.structured_analysis_markdown = ""
        empty_markdown = build_obsidian_markdown(empty_detail)

        self.assertNotIn("## 结构化总结", empty_markdown)

    def test_platform_labels_and_duration_format_in_frontmatter(self) -> None:
        """
        YAML 平台输出中文；时长输出 hh:mm:ss，不足一小时输出 mm:ss。
        """
        for platform, expected_label in [
            ("douyin", "抖音"),
            ("xiaoyuzhou", "小宇宙"),
            ("bilibili", "B 站"),
            ("xiaohongshu", "小红书"),
            ("unknown_platform", "unknown_platform"),
        ]:
            detail = _build_parse_response(
                summary_highlights=[],
                note_draft=None,
                platform=platform,
            )
            markdown = build_obsidian_markdown(detail)
            self.assertIn(f'平台: "{expected_label}"', markdown)

        long_detail = _build_parse_response(
            summary_highlights=[],
            note_draft=None,
            duration=3661,
        )
        self.assertIn('时长: "01:01:01"', build_obsidian_markdown(long_detail))

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
        self.assertIn('时长: "02:00"', markdown)
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
        self.assertNotIn("## 内容结构", markdown)
        self.assertIn("## 核心观点", markdown)
        self.assertIn("## 可应用场景", markdown)
        self.assertIn("## 内容边界与待核实信息", markdown)
        self.assertIn("ASR 可能存在识别误差", markdown)
        self.assertNotIn("## 压缩时间轴", markdown)
        self.assertNotIn("## 完整原文附录", markdown)
        self.assertIn("完整原文仍保存在知录本地记录中", markdown)
        self.assertNotIn("00:00", markdown)


def _build_parse_response(
    summary_highlights: list[SummaryHighlight],
    note_draft: NoteDraft | None,
    platform: str = "example",
    duration: int = 120,
) -> ParseResponse:
    return ParseResponse(
        source_url="https://example.com/video",
        video=VideoInfo(
            video_id="video_001",
            platform=platform,
            url="https://example.com/video",
            title="示例内容",
            author="示例作者",
            duration=duration,
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
