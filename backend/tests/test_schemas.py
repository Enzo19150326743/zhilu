import unittest

from pydantic import ValidationError

from app.schemas import ParseRequest, QaRequest, SummarizeRequest, TranscribeRequest


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

    def test_transcribe_request_defaults_to_local_whisper(self) -> None:
        request = TranscribeRequest(url="https://example.com/video")

        self.assertEqual(request.asr_engine, "local_whisper")

    def test_transcribe_request_accepts_sensevoice_small(self) -> None:
        request = TranscribeRequest(
            url="https://example.com/video",
            asr_engine="sensevoice_small",
        )

        self.assertEqual(request.asr_engine, "sensevoice_small")

    def test_transcribe_request_rejects_unknown_engine(self) -> None:
        with self.assertRaises(ValidationError):
            TranscribeRequest(
                url="https://example.com/video",
                asr_engine="unknown",  # type: ignore[arg-type]
            )

    def test_transcribe_request_rejects_removed_cloud_engine(self) -> None:
        with self.assertRaises(ValidationError):
            TranscribeRequest(
                url="https://example.com/video",
                asr_engine="fun_asr_flash",  # type: ignore[arg-type]
            )


if __name__ == "__main__":
    unittest.main()
