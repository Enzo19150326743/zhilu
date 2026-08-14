import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import main
from app.services import xiaohongshu_service


class XiaohongshuServiceTests(unittest.TestCase):
    def test_recognizes_supported_public_video_urls(self) -> None:
        self.assertTrue(
            xiaohongshu_service.is_xiaohongshu_url(
                "https://www.xiaohongshu.com/explore/6a2761520000000008032277"
            )
        )
        self.assertTrue(
            xiaohongshu_service.is_xiaohongshu_url(
                "https://www.xiaohongshu.com/discovery/item/6a2761520000000008032277"
            )
        )
        self.assertFalse(
            xiaohongshu_service.is_xiaohongshu_url(
                "https://xiaohongshu.com.example.test/explore/6a2761520000000008032277"
            )
        )

    def test_extracts_author_from_public_initial_state(self) -> None:
        note_id = "6a2761520000000008032277"
        payload = {
            "note": {
                "noteDetailMap": {
                    note_id: {
                        "note": {
                            "user": {
                                "nickname": "测试作者",
                                "userId": "author-id",
                            }
                        }
                    }
                }
            }
        }
        page = (
            "<script>window.__INITIAL_STATE__ = "
            f"{json.dumps(payload, ensure_ascii=False)}"
            "</script>"
        )

        self.assertEqual(
            xiaohongshu_service.extract_xiaohongshu_author(page, note_id),
            "测试作者",
        )

    def test_enriches_missing_author_without_replacing_ytdlp_metadata(self) -> None:
        response = SimpleNamespace(
            transcription_source_url=None,
            video=SimpleNamespace(
                author="未知作者",
                platform="XiaoHongShu",
                thumbnail="https://img.example/preview.jpg",
            ),
        )
        page = (
            '<script>window.__INITIAL_STATE__ = {"note":{"noteDetailMap":'
            '{"6a2761520000000008032277":{"note":{"user":'
            '{"nickname":"测试作者"}}}}}}</script>'
        )

        result = xiaohongshu_service.parse_xiaohongshu_video(
            "https://www.xiaohongshu.com/explore/6a2761520000000008032277",
            metadata_parser=lambda _: response,
            page_fetcher=lambda *_args, **_kwargs: page,
        )

        self.assertIs(result, response)
        self.assertEqual(result.video.author, "测试作者")
        self.assertEqual(result.video.platform, "xiaohongshu")

    def test_uses_clear_cover_and_public_media_stream_from_initial_state(self) -> None:
        note_id = "6a2761520000000008032277"
        response = SimpleNamespace(
            transcription_source_url=None,
            video=SimpleNamespace(
                author="已有作者",
                platform="XiaoHongShu",
                thumbnail="https://img.example/preview.jpg",
            ),
        )
        payload = {
            "note": {
                "noteDetailMap": {
                    note_id: {
                        "note": {
                            "imageList": [
                                {
                                    "urlPre": "https://img.example/pixelated.jpg",
                                    "urlDefault": "https://img.example/clear.jpg",
                                }
                            ],
                            "user": {"nickname": "页面作者"},
                            "video": {
                                "media": {
                                    "stream": {
                                        "h264": [
                                            {
                                                "audioCodec": "aac",
                                                "masterUrl": "https://video.example/with-audio.mp4",
                                                "size": 1024,
                                            }
                                        ]
                                    }
                                }
                            },
                        }
                    }
                }
            }
        }
        page = (
            "<script>window.__INITIAL_STATE__ = "
            f"{json.dumps(payload, ensure_ascii=False)}"
            "</script>"
        )

        result = xiaohongshu_service.parse_xiaohongshu_video(
            f"https://www.xiaohongshu.com/explore/{note_id}",
            metadata_parser=lambda _: response,
            page_fetcher=lambda *_args, **_kwargs: page,
        )

        self.assertEqual(result.video.author, "已有作者")
        self.assertEqual(result.video.thumbnail, "https://img.example/clear.jpg")
        self.assertEqual(
            result.transcription_source_url,
            "https://video.example/with-audio.mp4",
        )

    def test_keeps_ytdlp_cover_when_only_preview_image_exists(self) -> None:
        note_id = "6a2761520000000008032277"
        response = SimpleNamespace(
            transcription_source_url=None,
            video=SimpleNamespace(
                author="已有作者",
                platform="XiaoHongShu",
                thumbnail="https://img.example/ytdlp.jpg",
            ),
        )
        payload = {
            "note": {
                "noteDetailMap": {
                    note_id: {
                        "note": {
                            "imageList": [
                                {"urlPre": "https://img.example/pixelated.jpg"}
                            ],
                            "user": {"nickname": "页面作者"},
                        }
                    }
                }
            }
        }
        page = (
            "<script>window.__INITIAL_STATE__ = "
            f"{json.dumps(payload, ensure_ascii=False)}"
            "</script>"
        )

        result = xiaohongshu_service.parse_xiaohongshu_video(
            f"https://www.xiaohongshu.com/explore/{note_id}",
            metadata_parser=lambda _: response,
            page_fetcher=lambda *_args, **_kwargs: page,
        )

        self.assertEqual(result.video.thumbnail, "https://img.example/ytdlp.jpg")
        self.assertIsNone(result.transcription_source_url)

    def test_author_fetch_failure_does_not_block_video_metadata(self) -> None:
        response = SimpleNamespace(
            transcription_source_url=None,
            video=SimpleNamespace(
                author="未知作者",
                platform="XiaoHongShu",
                thumbnail="https://img.example/preview.jpg",
            ),
        )

        def failing_fetcher(*_args: object, **_kwargs: object) -> str:
            raise OSError("temporary page failure")

        result = xiaohongshu_service.parse_xiaohongshu_video(
            "https://www.xiaohongshu.com/explore/6a2761520000000008032277",
            metadata_parser=lambda _: response,
            page_fetcher=failing_fetcher,
        )

        self.assertEqual(result.video.author, "未知作者")
        self.assertEqual(result.video.platform, "xiaohongshu")

    def test_transcription_resolver_refreshes_xiaohongshu_media_url(self) -> None:
        source_url = (
            "https://www.xiaohongshu.com/explore/"
            "6a2761520000000008032277"
        )
        parse_response = SimpleNamespace(
            transcription_source_url="https://video.example/refreshed.mp4"
        )

        with patch("app.main.parse_media_source", return_value=parse_response):
            media_url, headers = main._resolve_transcription_source(source_url)

        self.assertEqual(media_url, "https://video.example/refreshed.mp4")
        self.assertIsNone(headers)

    def test_transcription_resolver_keeps_douyin_share_url_for_browser_download(self) -> None:
        source_url = "https://v.douyin.com/example/"

        media_url, headers = main._resolve_transcription_source(source_url)

        self.assertEqual(media_url, source_url)
        self.assertIsNone(headers)

    def test_metadata_refresh_preserves_existing_generated_content(self) -> None:
        source_url = (
            "https://www.xiaohongshu.com/explore/"
            "6a2761520000000008032277"
        )
        cached_detail = main.build_placeholder_parse_result(source_url)
        cached_detail.video = cached_detail.video.model_copy(
            update={
                "author": "已有作者",
                "has_transcript": True,
                "platform": "xiaohongshu",
                "text_source_type": "asr_transcript",
                "thumbnail": "https://img.example/old-preview.jpg",
            }
        )
        cached_detail.transcript = cached_detail.transcript.model_copy(
            update={"plain_text": "已经生成的真实转写稿"}
        )
        cached_detail.mindmap_markdown = "# 已生成导图"
        cached_detail.library_summary_status = "ai_generated"

        refreshed_detail = main.build_placeholder_parse_result(source_url)
        refreshed_detail.video = refreshed_detail.video.model_copy(
            update={
                "author": "刷新作者",
                "platform": "xiaohongshu",
                "thumbnail": "https://img.example/clear.jpg",
            }
        )
        refreshed_detail.transcription_source_url = (
            "https://video.example/refreshed.mp4"
        )

        merged_detail = main._merge_refreshed_xiaohongshu_detail(
            cached_detail,
            refreshed_detail,
        )

        self.assertEqual(merged_detail.video.author, "刷新作者")
        self.assertEqual(
            merged_detail.video.thumbnail,
            "https://img.example/clear.jpg",
        )
        self.assertTrue(merged_detail.video.has_transcript)
        self.assertEqual(
            merged_detail.video.text_source_type,
            "asr_transcript",
        )
        self.assertEqual(
            merged_detail.transcript.plain_text,
            "已经生成的真实转写稿",
        )
        self.assertEqual(merged_detail.mindmap_markdown, "# 已生成导图")
        self.assertEqual(merged_detail.library_summary_status, "ai_generated")

    def test_adapter_is_registered_before_generic_ytdlp_fallback(self) -> None:
        from app.services.media_source_service import MEDIA_SOURCE_ADAPTERS

        adapter_names = [adapter.source_name for adapter in MEDIA_SOURCE_ADAPTERS]
        self.assertLess(
            adapter_names.index("xiaohongshu_video"),
            adapter_names.index("ytdlp_video"),
        )


if __name__ == "__main__":
    unittest.main()
