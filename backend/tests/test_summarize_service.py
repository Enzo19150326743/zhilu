import json
import os
import unittest
from unittest.mock import patch

from app.schemas import ShownotesContext, ShownotesSpeaker, SummarizeRequest, TranscriptSegment
from app.services.deepseek_client import (
    DeepSeekClientError,
    DeepSeekOutputTruncatedError,
)
from app.services.summarize_service import (
    UNIVERSAL_KNOWLEDGE_DRAFT_VERSION,
    _build_deepseek_prompt,
    _request_deepseek_summary,
    summarize_transcript,
)


class SummarizeServiceTests(unittest.TestCase):
    def test_returns_local_fallback_without_deepseek_key(self) -> None:
        """
        未配置 DeepSeek Key 时，localhost 演示仍应返回稳定总结结构。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="第一段介绍主题。第二段说明关键结论。",
            video_author="示例作者",
            video_title="示例视频",
        )

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}, clear=False):
            response = summarize_transcript(request)

        self.assertFalse(response.is_ai_generated)
        self.assertIn("示例视频", response.summary.tldr)
        self.assertGreaterEqual(len(response.summary.key_points), 2)
        self.assertIn("# 示例视频", response.mindmap_markdown)
        self.assertIsNotNone(response.mindmap_meta)
        self.assertEqual(response.mindmap_meta.layout, "tree")
        self.assertEqual(
            response.summary.draft_version,
            UNIVERSAL_KNOWLEDGE_DRAFT_VERSION,
        )
        self.assertTrue(response.summary.content_keywords)
        self.assertEqual(response.summary.methods, [])
        self.assertEqual(response.summary.key_points_title, "内容要点")
        self.assertTrue(response.summary.content_outline)
        self.assertTrue(response.summary.content_boundaries)
        self.assertEqual(response.summary.personal_relevance, [])
        self.assertEqual(response.summary.related_wikilinks, [])

    def test_parses_deepseek_json_content(self) -> None:
        """
        DeepSeek 返回 JSON 文本时，应转换成前端既有 summary、mindmap 和导图元数据。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="足够长的字幕文本，用于触发 AI 总结。",
            video_author="示例作者",
            video_title="AI 访谈",
        )
        payload = {
            "draft_version": "1.1",
            "content_type": "播客",
            "topics": ["AI 产品", "工作流"],
            "summary_profile": "viewpoint",
            "tldr": "一句话总结",
            "key_points_title": "核心观点",
            "key_points": ["观点一", "观点二"],
            "content_outline": ["先讨论 AI 产品定位", "再分析工作流"],
            "method_title": "可借鉴的方法",
            "methods": ["先验证用户需求，再确定产品定位。"],
            "deep_dive_sections": [
                {"title": "论证与依据", "markdown": "### 观点\n通过案例说明产品定位。"}
            ],
            "content_keywords": ["AI 产品", "工作流", "内容总结"],
            "content_boundaries": ["当前结论只覆盖给定内容文本"],
            "quotes": [
                {
                    "text": "足够长的字幕文本",
                    "reason": "适合作为摘录",
                    "use_case": "观点转折",
                }
            ],
            "mindmap_markdown": "# AI 访谈\n## 观点",
            "mindmap_meta": {
                "layout": "tree",
                "content_category": "interview_podcast",
                "template_id": "interview_podcast_tree",
                "content_type": "播客",
            },
        }

        def fake_request(_: SummarizeRequest) -> str:
            return json.dumps(payload, ensure_ascii=False)

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            response = summarize_transcript(request, ai_requester=fake_request)

        self.assertTrue(response.is_ai_generated)
        self.assertEqual(response.summary.tldr, "一句话总结")
        self.assertEqual(response.summary.key_points, ["观点一", "观点二"])
        self.assertEqual(response.summary.content_type, "播客")
        self.assertEqual(response.summary.topics, ["AI 产品", "工作流"])
        self.assertEqual(response.summary.timeline, [])
        self.assertEqual(
            response.summary.methods,
            ["先验证用户需求，再确定产品定位。"],
        )
        self.assertEqual(response.summary.summary_profile, "viewpoint")
        self.assertEqual(response.summary.key_points_title, "核心观点")
        self.assertEqual(response.summary.content_outline, ["先讨论 AI 产品定位", "再分析工作流"])
        self.assertEqual(response.summary.method_title, "可借鉴的方法")
        self.assertEqual(response.summary.deep_dive_sections[0].title, "论证与依据")
        self.assertIn("## 论证与依据", response.summary.structured_analysis_markdown)
        self.assertEqual(
            response.summary.content_keywords,
            ["AI 产品", "工作流", "内容总结"],
        )
        self.assertIn(
            "当前结论只覆盖给定内容文本",
            response.summary.content_boundaries,
        )
        self.assertEqual(response.summary.takeaways, response.summary.methods)
        self.assertEqual(response.summary.search_keywords, response.summary.content_keywords)
        self.assertEqual(response.summary.personal_relevance, [])
        self.assertEqual(response.summary.transformation_ideas, [])
        self.assertEqual(response.summary.related_wikilinks, [])
        self.assertEqual(response.summary.to_confirm, [])
        self.assertEqual(response.mindmap_markdown, "# AI 访谈\n## 观点")
        self.assertIsNotNone(response.mindmap_meta)
        self.assertEqual(response.mindmap_meta.content_category, "interview_podcast")
        self.assertEqual(response.mindmap_meta.template_id, "interview_podcast_tree")

    def test_invalid_mindmap_meta_falls_back_to_general_tree(self) -> None:
        """
        AI 返回未知导图分类时，后端应回落到通用树图，避免前端收到不可识别模板。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="字幕文本。",
            video_title="示例内容",
        )
        payload = {
            "tldr": "一句话总结",
            "key_points": ["观点一"],
            "structured_analysis_markdown": "## 分析",
            "takeaways": ["行动建议"],
            "mindmap_markdown": "# 示例内容\n## 观点",
            "mindmap_meta": {
                "layout": "radial",
                "content_category": "news_commentary",
                "template_id": "news_commentary_tree",
            },
        }

        def fake_request(_: SummarizeRequest) -> str:
            return json.dumps(payload, ensure_ascii=False)

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            response = summarize_transcript(request, ai_requester=fake_request)

        self.assertIsNotNone(response.mindmap_meta)
        self.assertEqual(response.mindmap_meta.layout, "tree")
        self.assertEqual(response.mindmap_meta.content_category, "general")
        self.assertEqual(response.mindmap_meta.template_id, "general_tree")

    def test_deepseek_summary_uses_long_timeout_for_large_context(self) -> None:
        """
        长文本总结不能沿用 45 秒短超时，否则模型仍在生成时会被本地读超时打断。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="长文本内容。" * 1000,
            video_title="长文本示例",
        )
        payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "tldr": "完成",
                                "key_points": ["要点"],
                                "structured_analysis_markdown": "## 分析",
                                "takeaways": ["建议"],
                                "mindmap_markdown": "# 长文本示例",
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            with patch(
                "app.services.summarize_service.post_deepseek_chat_completion",
                return_value=payload,
            ) as post_deepseek:
                _request_deepseek_summary(request)

        self.assertGreaterEqual(
            post_deepseek.call_args.kwargs["timeout_seconds"],
            120,
        )

    def test_prompt_keeps_content_after_previous_character_limit(self) -> None:
        """
        超过旧 16000 字限制的正文尾部也必须完整进入总结提示词。
        """
        unique_tail = "总结尾部唯一标记-7f4a9c"
        request = SummarizeRequest(
            transcript_plain_text=f"{'前' * 20000}{unique_tail}",
            video_title="长文本示例",
        )

        prompt = _build_deepseek_prompt(request)

        self.assertIn(unique_tail, prompt)

    def test_finish_reason_length_is_not_silently_fallbacked(self) -> None:
        """
        模型明确报告输出被截断时，应中止并抛出专用错误。
        """
        request = SummarizeRequest(
            transcript_plain_text="用于测试输出截断的内容文本。",
            video_title="输出截断示例",
        )
        response_payload = {
            "choices": [
                {
                    "finish_reason": "length",
                    "message": {"content": '{"tldr":"未完成"'},
                }
            ]
        }

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            with patch(
                "app.services.summarize_service.post_deepseek_chat_completion",
                return_value=response_payload,
            ):
                with self.assertRaises(DeepSeekOutputTruncatedError):
                    _request_deepseek_summary(request)

            def raise_truncated(_: SummarizeRequest) -> str:
                raise DeepSeekOutputTruncatedError("AI 输出达到长度限制")

            with self.assertRaises(DeepSeekOutputTruncatedError):
                summarize_transcript(request, ai_requester=raise_truncated)

    def test_prompt_marks_podcast_shownotes_as_non_transcript(self) -> None:
        """
        播客 shownotes 只能代表公开内容简介，不能被提示词误写成完整逐字稿。
        """
        request = SummarizeRequest(
            source_url="https://www.xiaoyuzhoufm.com/episode/example",
            transcript_plain_text="本期讨论 AI 产品定位和访谈要点。",
            video_author="示例播客",
            video_title="播客单集",
            media_type="podcast",
            text_source_type="shownotes",
        )

        prompt = _build_deepseek_prompt(request)

        self.assertIn("内容类型：播客", prompt)
        self.assertIn("不是完整逐字稿", prompt)
        self.assertIn("shownotes 只能代表公开内容简介", prompt)
        self.assertIn('"content_type": "视频或播客"', prompt)
        self.assertIn('"quotes"', prompt)
        self.assertIn('"draft_version": "1.1"', prompt)
        self.assertIn('"content_keywords"', prompt)
        self.assertIn('"summary_profile"', prompt)
        self.assertIn('"methods"', prompt)
        self.assertIn('"deep_dive_sections"', prompt)
        self.assertIn('"content_boundaries"', prompt)
        self.assertIn("mindmap_meta", prompt)
        self.assertNotIn("视频字幕", prompt)

    def test_prompt_separates_transcript_from_shownotes_evidence(self) -> None:
        request = SummarizeRequest(
            source_url="https://example.com/podcast",
            transcript_plain_text="转写稿中的真实发言。",
            shownotes_plain_text="节目宣传文案，不是嘉宾发言。",
            shownotes_context=ShownotesContext(
                program_structure="interview",
                speakers=[ShownotesSpeaker(name="泓君", role="主持人", confidence="high")],
                terms=["FDE"],
            ),
            media_type="podcast",
            text_source_type="asr_transcript",
        )

        prompt = _build_deepseek_prompt(request)

        self.assertIn("主要证据：完整校对转写稿", prompt)
        self.assertIn("辅助人物与术语信息（shownotes_context）", prompt)
        self.assertIn("辅助节目资料（原始 shownotes）", prompt)
        self.assertIn("quotes 原文摘录只能来自完整转写稿", prompt)
        self.assertIn("转写稿中的真实发言", prompt)
        self.assertIn("节目宣传文案，不是嘉宾发言", prompt)

    def test_prompt_is_generic_and_excludes_personal_avatar_context(self) -> None:
        """
        默认提示词只处理当前来源，不携带当前用户的数字分身背景或固定页面名。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="内容讨论如何校验资料来源并整理结构化笔记。",
            video_author="示例作者",
            video_title="资料整理方法",
            media_type="video",
            text_source_type="subtitle",
        )

        prompt = _build_deepseek_prompt(request)
        forbidden_terms = [
            "数字分身",
            "私人知识助理",
            "自由与选择权",
            "反焦虑",
            "个人 IP",
            "价值观档案",
            "表达风格档案",
            "用户已经认同",
        ]

        for forbidden_term in forbidden_terms:
            self.assertNotIn(forbidden_term, prompt)
        self.assertIn("单来源通用知识草稿", prompt)
        self.assertIn("只根据当前媒体元数据和内容文本", prompt)

    def test_system_prompt_is_generic_and_requires_json(self) -> None:
        """
        发给模型的 System Prompt 也必须通用，并继续强制合法 JSON。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="示例内容文本。",
            video_title="示例内容",
        )
        response_payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "tldr": "示例摘要",
                                "key_points": ["示例观点"],
                                "structured_analysis_markdown": "## 内容结构",
                                "application_clues": ["可用于快速复习"],
                                "content_keywords": ["示例"],
                                "content_boundaries": ["仅覆盖当前文本"],
                                "mindmap_markdown": "# 示例内容",
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            with patch(
                "app.services.summarize_service.post_deepseek_chat_completion",
                return_value=response_payload,
            ) as post_deepseek:
                _request_deepseek_summary(request)

        system_prompt = post_deepseek.call_args.kwargs["payload"]["messages"][0][
            "content"
        ]
        self.assertIn("通用知识草稿", system_prompt)
        self.assertIn("必须返回合法 JSON", system_prompt)
        self.assertNotIn("数字分身", system_prompt)
        self.assertNotIn("私人知识助理", system_prompt)

    def test_fallback_reason_includes_safe_http_detail(self) -> None:
        """
        DeepSeek 请求失败时，前端应能看到非敏感失败原因，而不是只能看后端日志。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="第一段介绍主题。第二段说明关键结论。",
            video_title="示例视频",
        )

        def fake_request(_: SummarizeRequest) -> str:
            raise DeepSeekClientError(
                'status=402 reason=Payment Required body={"error":{"message":"Insufficient Balance"}}'
            )

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            response = summarize_transcript(request, ai_requester=fake_request)

        self.assertFalse(response.is_ai_generated)
        self.assertIsNotNone(response.fallback_reason)
        self.assertIn("DeepSeekClientError", response.fallback_reason)
        self.assertIn("status=402", response.fallback_reason)
        self.assertIn("Insufficient Balance", response.fallback_reason)

    def test_prompt_excludes_unreliable_timeline_fields(self) -> None:
        """
        AI 总结提示词不再要求模型输出时间轴和起止时间。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="第一段介绍主题。第二段说明关键结论。",
            video_title="示例视频",
            transcript_segments=[
                TranscriptSegment(start=12.4, end=18.2, text="第一段介绍主题。"),
                TranscriptSegment(start=75.2, end=83.8, text="第二段说明关键结论。"),
            ],
        )

        prompt = _build_deepseek_prompt(request)

        self.assertIn("不生成时间轴、时间点、开始时间或结束时间", prompt)
        self.assertNotIn('"timeline"', prompt)
        self.assertNotIn('"start"', prompt)
        self.assertNotIn('"end"', prompt)

    def test_local_fallback_does_not_generate_timeline(self) -> None:
        """
        本地兜底摘要也不生成不可靠时间轴。
        """
        request = SummarizeRequest(
            source_url="https://example.com/video",
            transcript_plain_text="第一段介绍主题。第二段说明关键结论。",
            video_title="示例视频",
            transcript_segments=[
                TranscriptSegment(start=12.4, end=18.2, text="第一段介绍主题。"),
                TranscriptSegment(start=75.2, end=83.8, text="第二段说明关键结论。"),
            ],
        )

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}, clear=False):
            response = summarize_transcript(request)

        self.assertEqual(response.summary.timeline, [])


if __name__ == "__main__":
    unittest.main()
