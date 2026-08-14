import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.douyin_service import (
    DouyinPublicClient,
    create_douyin_transcription_downloader,
    parse_douyin_video,
)


class DouyinServiceTestCase(unittest.TestCase):
    def test_transcription_downloader_uses_browser_media_request(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            downloader = create_douyin_transcription_downloader(output_dir)

            with patch.object(DouyinPublicClient, "download_browser_media") as download:
                result = downloader("https://v.douyin.com/example/")

        self.assertEqual(result.name, "douyin-transcribe.mp4")
        download.assert_called_once_with(
            "https://v.douyin.com/example/",
            result,
        )

    def test_uses_browser_as_primary_parser_without_requesting_static_page(self) -> None:
        resolved_url = "https://www.douyin.com/video/445566"
        browser_item = {
            "aweme_id": "445566",
            "desc": "浏览器后备解析的视频",
            "author": {"nickname": "测试作者"},
            "video": {
                "duration": 15_000,
                "width": 1080,
                "height": 1920,
                "data_size": 1024,
                "cover": {"url_list": ["https://media.example.test/cover.jpg"]},
                "play_addr": {
                    "url_list": ["https://media.example.test/play/video.mp4"]
                },
            },
        }

        with (
            patch.object(DouyinPublicClient, "resolve", return_value=resolved_url),
            patch.object(DouyinPublicClient, "read_text") as read_text,
            patch.object(
                DouyinPublicClient,
                "read_browser_item",
                return_value=browser_item,
            ) as read_browser_item,
        ):
            result = parse_douyin_video("https://v.douyin.com/example/")

        read_browser_item.assert_called_once_with(resolved_url)
        read_text.assert_not_called()
        self.assertEqual(result.video.video_id, "douyin_445566")
        self.assertEqual(result.video.title, "浏览器后备解析的视频")
        self.assertEqual(
            result.transcription_source_url,
            "https://media.example.test/play/video.mp4",
        )


if __name__ == "__main__":
    unittest.main()
