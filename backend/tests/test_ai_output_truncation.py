import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.main import answer_media_question, summarize_video
from app.schemas import QaRequest, SummarizeRequest
from app.services.deepseek_client import DeepSeekOutputTruncatedError


class AiOutputTruncationApiTests(unittest.TestCase):
    def test_summary_returns_explicit_output_truncated_error(self) -> None:
        summarize_request = SummarizeRequest(
            transcript_plain_text="用于测试的内容文本。",
        )

        with patch("app.main.enforce_rate_limit"):
            with patch(
                "app.main.summarize_transcript",
                side_effect=DeepSeekOutputTruncatedError("输出不完整"),
            ):
                with self.assertRaises(HTTPException) as raised:
                    summarize_video(object(), summarize_request)  # type: ignore[arg-type]

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(
            raised.exception.detail["error_code"],
            "AI_OUTPUT_TRUNCATED",
        )
        self.assertIn("结果未完整生成", raised.exception.detail["message"])

    def test_qa_returns_explicit_output_truncated_error(self) -> None:
        qa_request = QaRequest(
            question="核心结论是什么？",
            transcript_plain_text="用于测试的内容文本。",
        )

        with patch("app.main.enforce_rate_limit"):
            with patch(
                "app.main.answer_question",
                side_effect=DeepSeekOutputTruncatedError("输出不完整"),
            ):
                with self.assertRaises(HTTPException) as raised:
                    answer_media_question(object(), qa_request)  # type: ignore[arg-type]

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(
            raised.exception.detail["error_code"],
            "AI_OUTPUT_TRUNCATED",
        )
        self.assertIn("结果未完整生成", raised.exception.detail["message"])


if __name__ == "__main__":
    unittest.main()
