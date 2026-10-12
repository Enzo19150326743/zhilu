import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.services import library_service, processing_service
from tests.factories import build_parse_response


class ProcessingServiceTests(unittest.TestCase):
    def test_transcription_source_preserves_callers_retry_policy(self):
        source_url = "https://www.xiaohongshu.com/explore/000000000000000000000001"
        with patch.object(
            processing_service, "parse_media_source",
            side_effect=HTTPException(status_code=502, detail="平台暂时不可用"),
        ):
            with self.assertRaises(HTTPException):
                processing_service.resolve_transcription_media(source_url)
            self.assertEqual(
                processing_service.resolve_transcription_media(source_url, allow_source_fallback=True),
                (source_url, None, None),
            )

    def test_failed_metadata_refresh_preserves_saved_author_cover_and_transcript(self):
        source_url = "https://www.xiaohongshu.com/explore/000000000000000000000001"
        cached = build_parse_response(source_url)
        cached.is_placeholder = False
        cached.video = cached.video.model_copy(update={
            "platform": "xiaohongshu",
            "author": "原作者",
            "thumbnail": "https://example.com/saved-cover.jpg",
            "has_transcript": True,
            "text_source_type": "asr_transcript",
        })
        cached.transcript.plain_text = "已保存的完整转写稿。"
        refreshed = cached.model_copy(deep=True)
        refreshed.video.author = "未知作者"
        refreshed.video.thumbnail = "https://example.com/placeholder.jpg"
        refreshed.video.has_transcript = False
        refreshed.video.text_source_type = None
        refreshed.transcript.plain_text = ""
        refreshed.transcription_source_url = None

        with tempfile.TemporaryDirectory() as directory, patch.object(
            library_service, "DATABASE_PATH", Path(directory) / "library.sqlite3"
        ):
            library_service.upsert_library_item(cached)
            with patch.object(processing_service, "parse_media_source", return_value=refreshed) as parse:
                result = processing_service.parse_and_persist(source_url)
                parse.assert_called_once_with(source_url)
            saved = library_service.get_library_detail_by_source_url(source_url)

        self.assertEqual(result.video.author, "原作者")
        self.assertEqual(result.video.thumbnail, "https://example.com/saved-cover.jpg")
        self.assertTrue(result.video.has_transcript)
        self.assertEqual(result.transcript.plain_text, "已保存的完整转写稿。")
        self.assertEqual(saved.video.author, result.video.author)
        self.assertEqual(saved.video.thumbnail, result.video.thumbnail)


if __name__ == "__main__":
    unittest.main()
