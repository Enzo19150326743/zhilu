import unittest

from pydantic import ValidationError

from app.schemas import ParseRequest, QaRequest, SummarizeRequest, TaskBatchCreateRequest, TranscribeRequest


class SummarizeRequestSchemaTests(unittest.TestCase):
    def test_parse_request_only_contains_url(self) -> None:
        request = ParseRequest(url="https://example.com/video")

        self.assertEqual(
            request.model_dump(),
            {"url": "https://example.com/video"},
        )

    def test_long_video_title_is_normalized_before_validation(self) -> None:
        request = SummarizeRequest(
            transcript_plain_text="有效转写稿",
            video_title=f"  {'题' * 688}  ",
        )

        self.assertEqual(len(request.video_title or ""), 300)
        self.assertEqual(request.video_title, "题" * 300)

    def test_blank_video_title_becomes_none(self) -> None:
        request = SummarizeRequest(
            transcript_plain_text="有效转写稿",
            video_title="   ",
        )

        self.assertIsNone(request.video_title)

    def test_transcript_accepts_exactly_120000_characters(self) -> None:
        transcript = "字" * 120000

        summarize_request = SummarizeRequest(transcript_plain_text=transcript)
        qa_request = QaRequest(question="问题", transcript_plain_text=transcript)

        self.assertEqual(len(summarize_request.transcript_plain_text), 120000)
        self.assertEqual(len(qa_request.transcript_plain_text), 120000)

    def test_transcript_rejects_more_than_120000_characters(self) -> None:
        transcript = "字" * 120001

        with self.assertRaises(ValidationError):
            SummarizeRequest(transcript_plain_text=transcript)

        with self.assertRaises(ValidationError):
            QaRequest(question="问题", transcript_plain_text=transcript)

    def test_transcribe_request_contains_only_content_and_context(self) -> None:
        request = TranscribeRequest(url="https://example.com/video")
        self.assertEqual(set(request.model_dump()), {"url", "video_id", "context_settings"})

    def test_batch_request_contains_only_content_and_context(self) -> None:
        request = TaskBatchCreateRequest(
            client_request_id="default-asr-engine",
            urls=["https://example.com/video"],
        )
        self.assertEqual(set(request.model_dump()), {"client_request_id", "urls", "context_settings"})

    def test_old_selection_fields_cannot_select_a_different_pipeline(self) -> None:
        request = TaskBatchCreateRequest.model_validate({
            "client_request_id": "legacy-pipeline-request",
            "urls": ["https://example.com/video"],
            "target": "parse_only",
            "asr_engine": "removed-engine",
        })
        self.assertEqual(request.model_dump(), {
            "client_request_id": "legacy-pipeline-request",
            "urls": ["https://example.com/video"],
            "context_settings": None,
        })


if __name__ == "__main__":
    unittest.main()
