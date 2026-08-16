import os
import unittest
from unittest.mock import patch

from app.schemas import ShownotesContext
from app.services.shownotes_context_service import extract_shownotes_context


class ShownotesContextServiceTests(unittest.TestCase):
    def test_extracts_speakers_terms_and_outline_from_json(self) -> None:
        response_payload = {
            "choices": [
                {
                    "message": {
                        "content": (
                            '{"program_structure":"interview",'
                            '"speakers":[{"name":"泓君","role":"主持人",'
                            '"description":"负责提问","confidence":"high"},'
                            '{"name":"朋新宇","role":"嘉宾",'
                            '"description":"阿里瓴羊 CEO","confidence":"high"}],'
                            '"terms":["FDE","阿里瓴羊","FDE"],'
                            '"content_outline":["企业 AI 落地"]}'
                        )
                    }
                }
            ]
        }

        with patch.dict(os.environ, {"AI_API_KEY": "test-key"}, clear=False):
            with patch(
                "app.services.shownotes_context_service.post_deepseek_chat_completion",
                return_value=response_payload,
            ) as request_mock:
                context = extract_shownotes_context(
                    "主持人泓君采访嘉宾朋新宇，讨论 FDE。",
                    title="企业 AI",
                    author="示例播客",
                )

        self.assertIsNotNone(context)
        self.assertEqual(context.program_structure, "interview")
        self.assertEqual([item.name for item in context.speakers], ["泓君", "朋新宇"])
        self.assertEqual(context.terms, ["FDE", "阿里瓴羊"])
        request_mock.assert_called_once()
        self.assertEqual(request_mock.call_args.kwargs["max_attempts"], 1)

    def test_invalid_json_does_not_block_and_returns_none(self) -> None:
        with patch.dict(os.environ, {"AI_API_KEY": "test-key"}, clear=False):
            with patch(
                "app.services.shownotes_context_service.post_deepseek_chat_completion",
                return_value={
                    "choices": [{"message": {"content": "not-json"}}]
                },
            ):
                context = extract_shownotes_context("有 shownotes")

        self.assertIsNone(context)

    def test_empty_shownotes_skips_api(self) -> None:
        with patch(
            "app.services.shownotes_context_service.post_deepseek_chat_completion"
        ) as request_mock:
            context = extract_shownotes_context("   ")

        self.assertIsNone(context)
        request_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
