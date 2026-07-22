import time
import unittest
from multiprocessing.queues import Queue
from typing import Any
from unittest.mock import patch

from fastapi import HTTPException

from app.schemas import TranscriptPayload
from app.services import ytdlp_service


def sleeping_ytdlp_worker(
    _: str, __: dict[str, Any], result_queue: Queue
) -> None:
    """
    模拟外部平台长时间不返回的解析过程。
    """
    time.sleep(5)
    result_queue.put({"status": "ok", "raw_info": {"id": "late_result"}})


def bili_platform_rejected_worker(
    _: str, __: dict[str, Any], result_queue: Queue
) -> None:
    """
    模拟 B 站反爬或请求条件失败。
    """
    result_queue.put(
        {
            "status": "error",
            "error_type": "DownloadError",
            "message": "HTTP Error 412: Precondition Failed",
        }
    )


def youtube_requires_verification_worker(
    _: str, __: dict[str, Any], result_queue: Queue
) -> None:
    """
    模拟 YouTube 要求登录或机器人验证。
    """
    result_queue.put(
        {
            "status": "error",
            "error_type": "DownloadError",
            "message": "Sign in to confirm you're not a bot",
        }
    )


class YtdlpTimeoutTests(unittest.TestCase):
    def test_extractor_process_is_terminated_when_deadline_expires(self) -> None:
        """
        B 站等外部平台卡住时，后端应主动结束子进程并返回结构化超时错误。
        """
        started_at = time.perf_counter()

        with self.assertRaises(HTTPException) as raised:
            ytdlp_service._extract_raw_info_with_timeout(
                "https://example.com/video",
                {},
                timeout_seconds=0.2,
                worker_target=sleeping_ytdlp_worker,
            )

        elapsed = time.perf_counter() - started_at
        self.assertLess(elapsed, 2)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["error_code"], "PARSE_TIMEOUT")

    def test_platform_rejected_error_uses_clear_message(self) -> None:
        """
        平台拒绝本地解析时，不应误导用户去检查公开媒体属性。
        """
        with self.assertRaises(HTTPException) as raised:
            ytdlp_service._extract_raw_info_with_timeout(
                "https://bilibili.com/video/example",
                {},
                timeout_seconds=2,
                worker_target=bili_platform_rejected_worker,
            )

        self.assertEqual(raised.exception.detail["error_code"], "PLATFORM_REJECTED")
        self.assertEqual(
            raised.exception.detail["message"],
            "平台拒绝了本地解析请求，请换一个公开媒体链接或稍后重试。",
        )

    def test_verification_error_uses_restricted_message(self) -> None:
        """
        平台要求登录或验证时，应明确当前 V0.1 不支持这类内容。
        """
        with self.assertRaises(HTTPException) as raised:
            ytdlp_service._extract_raw_info_with_timeout(
                "https://www.youtube.com/watch?v=example",
                {},
                timeout_seconds=2,
                worker_target=youtube_requires_verification_worker,
            )

        self.assertEqual(raised.exception.detail["error_code"], "ACCESS_RESTRICTED")
        self.assertEqual(
            raised.exception.detail["message"],
            "该内容需要登录、验证或权限确认，当前版本仅支持无需登录的公开媒体内容。",
        )

    def test_platform_rejected_can_retry_before_giving_up(self) -> None:
        """
        B 站 412 有波动，快速平台拒绝应允许窄范围重试。
        """
        attempts = 0

        def flaky_extractor(_: str, __: dict[str, Any]) -> dict[str, Any]:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise ytdlp_service._build_parse_error(
                    "PLATFORM_REJECTED",
                    "平台拒绝了本地解析请求，请换一个公开媒体链接或稍后重试。",
                )

            return {"id": "recovered_video"}

        raw_info = ytdlp_service._extract_raw_info_with_retries(
            "https://www.bilibili.com/video/example",
            {},
            max_attempts=3,
            retry_delay_seconds=0,
            extractor=flaky_extractor,
        )

        self.assertEqual(raw_info["id"], "recovered_video")
        self.assertEqual(attempts, 2)

    def test_bilibili_extract_options_include_browser_headers(self) -> None:
        """
        B 站公开解析需要带浏览器请求头，避免元数据阶段被平台快速拒绝。
        """
        options = ytdlp_service._build_extract_options(
            "https://www.bilibili.com/video/BV141Vn6MEKv"
        )

        headers = options.get("http_headers")
        self.assertIsInstance(headers, dict)
        self.assertIn("Chrome", headers["User-Agent"])
        self.assertEqual(
            headers["Referer"],
            "https://www.bilibili.com/video/BV141Vn6MEKv",
        )
        self.assertIn("zh-CN", headers["Accept-Language"])

    def test_bilibili_rejection_falls_back_to_public_metadata(self) -> None:
        """
        B 站播放格式接口被拒绝时，仍应保留公开元数据解析能力。
        """
        rejected_error = ytdlp_service._build_parse_error(
            "PLATFORM_REJECTED",
            "平台拒绝了本地解析请求，请换一个公开媒体链接或稍后重试。",
        )
        fallback_raw_info = {
            "_metadata_source": ytdlp_service.BILIBILI_PUBLIC_METADATA_SOURCE,
            "id": "BV1pNVz6JEJS",
            "extractor_key": "BiliBili",
            "webpage_url": "https://www.bilibili.com/video/BV1pNVz6JEJS",
            "title": "公开元数据标题",
            "uploader": "测试作者",
            "duration": 1305,
            "thumbnail": "https://example.com/cover.jpg",
            "formats": [],
        }

        with patch.object(
            ytdlp_service,
            "_extract_raw_info_with_retries",
            side_effect=rejected_error,
        ), patch.object(
            ytdlp_service,
            "_fetch_bilibili_public_raw_info",
            return_value=fallback_raw_info,
        ), patch.object(
            ytdlp_service,
            "extract_transcript_payload",
            return_value=TranscriptPayload(segments=[], plain_text=""),
        ):
            response = ytdlp_service.extract_video_metadata(
                "https://www.bilibili.com/video/BV1pNVz6JEJS"
            )

        self.assertEqual(response.video.video_id, "BV1pNVz6JEJS")
        self.assertEqual(response.video.title, "公开元数据标题")
        self.assertEqual(response.video.author, "测试作者")
        self.assertEqual(response.formats, [])
        self.assertTrue(response.format_diagnostics.is_bilibili)
        self.assertIn("B 站公开接口", response.summary.key_points[0])


if __name__ == "__main__":
    unittest.main()
