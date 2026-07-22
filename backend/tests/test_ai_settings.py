import os
import unittest
from unittest.mock import patch

from app.schemas import SummarizeRequest
from app.services.ai_settings import load_ai_settings
from app.services.summarize_service import _request_deepseek_summary


class AiSettingsTestCase(unittest.TestCase):
    def test_generic_variables_take_precedence_over_legacy_variables(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "openai-compatible",
                "AI_API_KEY": "generic-key",
                "AI_BASE_URL": "https://example.test/v1",
                "AI_MODEL": "example-model",
                "AI_FAST_MODEL": "example-fast-model",
                "DEEPSEEK_API_KEY": "legacy-key",
                "DEEPSEEK_BASE_URL": "https://api.deepseek.com",
                "DEEPSEEK_MODEL": "deepseek-v4-pro",
            },
            clear=True,
        ):
            settings = load_ai_settings()

        self.assertEqual(settings.provider, "openai-compatible")
        self.assertEqual(settings.api_key, "generic-key")
        self.assertEqual(settings.base_url, "https://example.test/v1")
        self.assertEqual(settings.model, "example-model")
        self.assertEqual(settings.fast_model, "example-fast-model")
        self.assertFalse(settings.supports_deepseek_thinking)

    def test_legacy_deepseek_variables_remain_supported(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DEEPSEEK_API_KEY": "legacy-key",
                "DEEPSEEK_BASE_URL": "https://legacy.example",
                "DEEPSEEK_MODEL": "legacy-model",
                "DEEPSEEK_QA_FAST_MODEL": "legacy-fast-model",
            },
            clear=True,
        ):
            settings = load_ai_settings()

        self.assertEqual(settings.provider, "deepseek")
        self.assertEqual(settings.api_key, "legacy-key")
        self.assertEqual(settings.base_url, "https://legacy.example")
        self.assertEqual(settings.model, "legacy-model")
        self.assertEqual(settings.fast_model, "legacy-fast-model")
        self.assertTrue(settings.supports_deepseek_thinking)

    def test_defaults_are_safe_and_do_not_invent_an_api_key(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_ai_settings()

        self.assertEqual(settings.provider, "deepseek")
        self.assertEqual(settings.api_key, "")
        self.assertEqual(settings.base_url, "https://api.deepseek.com")
        self.assertTrue(settings.supports_deepseek_thinking)

    def test_summary_request_uses_generic_openai_compatible_settings(self) -> None:
        request = SummarizeRequest(
            source_url="https://example.test/video",
            transcript_plain_text="这是一段用于测试通用 AI 配置的内容。",
            video_title="通用配置测试",
        )
        response = {"choices": [{"message": {"content": "{}"}}]}
        with patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "openai-compatible",
                "AI_API_KEY": "generic-key",
                "AI_BASE_URL": "https://example.test/v1",
                "AI_MODEL": "example-model",
            },
            clear=True,
        ):
            with patch(
                "app.services.summarize_service.post_deepseek_chat_completion",
                return_value=response,
            ) as post_completion:
                _request_deepseek_summary(request)

        call = post_completion.call_args.kwargs
        self.assertEqual(call["api_key"], "generic-key")
        self.assertEqual(call["base_url"], "https://example.test/v1")
        self.assertEqual(call["payload"]["model"], "example-model")
        self.assertNotIn("thinking", call["payload"])


if __name__ == "__main__":
    unittest.main()
