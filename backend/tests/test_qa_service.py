import json
import os
import unittest
from unittest.mock import patch

from app.schemas import QaRequest
from app.services.qa_service import _build_deepseek_prompt, answer_question


class QaServiceTests(unittest.TestCase):
    def test_returns_local_fallback_without_deepseek_key(self) -> None:
        """
        未配置 DeepSeek Key 时，真实 QA 入口也要保持本地演示可用。
        """
        request = QaRequest(
            question="这个内容的核心观点是什么？",
            transcript_plain_text="第一段介绍 AI 产品定位。第二段说明知识沉淀是核心价值。",
            video_author="示例作者",
            video_title="AI 产品访谈",
        )

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}, clear=False):
            response = answer_question(request)

        self.assertFalse(response.is_ai_generated)
        self.assertIn("AI 产品访谈", response.answer)
        self.assertGreaterEqual(len(response.references), 1)

    def test_parses_deepseek_json_content(self) -> None:
        """
        DeepSeek 返回 JSON 文本时，应转换成前端可展示的 answer 和 references。
        """
        request = QaRequest(
            question="核心结论是什么？",
            transcript_plain_text="核心结论是先做内容理解，再扩展平台适配。",
            video_author="示例作者",
            video_title="媒体内容工作台",
        )
        payload = {
            "answer": "核心结论是先稳定内容理解闭环，再扩展平台适配。",
            "references": [
                {
                    "time": "00:00",
                    "text": "核心结论是先做内容理解，再扩展平台适配。",
                }
            ],
        }

        def fake_request(_: QaRequest) -> str:
            return json.dumps(payload, ensure_ascii=False)

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False):
            response = answer_question(request, ai_requester=fake_request)

        self.assertTrue(response.is_ai_generated)
        self.assertEqual(response.answer, payload["answer"])
        self.assertEqual(response.references[0].time, "00:00")

    def test_prompt_marks_podcast_shownotes_as_non_transcript(self) -> None:
        """
        播客 shownotes 只能代表公开内容简介，QA 不能暗示它是完整逐字稿。
        """
        request = QaRequest(
            question="嘉宾主要讨论了什么？",
            transcript_plain_text="本期 shownotes 提到 AI 产品定位和内容工作流。",
            video_author="示例播客",
            video_title="播客单集",
            media_type="podcast",
            text_source_type="shownotes",
        )

        prompt = _build_deepseek_prompt(request)

        self.assertIn("文本来源：shownotes / 内容简介", prompt)
        self.assertIn("不是完整逐字稿", prompt)
        self.assertNotIn("视频字幕", prompt)


if __name__ == "__main__":
    unittest.main()
