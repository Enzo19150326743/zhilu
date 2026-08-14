import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from fastapi import HTTPException

from app.services.douyin_service import (
    DouyinPublicClient,
    create_douyin_transcription_downloader,
    parse_douyin_video,
)


class DouyinServiceTestCase(unittest.TestCase):
    def test_browser_detail_request_retries_after_temporary_failure(self) -> None:
        browser_item = {
            "aweme_id": "445566",
            "video": {"play_addr": {"url_list": ["https://media.example/video.mp4"]}},
        }
        failed_result = CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="page.waitForResponse: Timeout 15000ms exceeded",
        )
        successful_result = CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"aweme_id": "445566", "video": {"play_addr": {"url_list": ["https://media.example/video.mp4"]}}}',
            stderr="",
        )

        with (
            patch("app.services.douyin_service.shutil.which", return_value="node"),
            patch(
                "app.services.douyin_service.subprocess.run",
                side_effect=[failed_result, successful_result],
            ) as run_browser,
            patch("app.services.douyin_service.time.sleep") as sleep,
        ):
            result = DouyinPublicClient().read_browser_item(
                "https://v.douyin.com/example/"
            )

        self.assertEqual(result, browser_item)
        self.assertEqual(run_browser.call_count, 2)
        sleep.assert_called_once_with(2)

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

    def test_transcription_downloader_reports_retried_detail_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            downloader = create_douyin_transcription_downloader(
                Path(temporary_directory)
            )
            with patch.object(
                DouyinPublicClient,
                "download_browser_media",
                side_effect=OSError("douyin browser request failed after retries"),
            ):
                with self.assertRaises(HTTPException) as captured:
                    downloader("https://v.douyin.com/example/")

        self.assertEqual(
            captured.exception.detail["message"],
            "音频下载失败：抖音暂时没有返回播放详情，已自动重试，请稍后再试。",
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
