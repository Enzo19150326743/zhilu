import base64
import hashlib
import html
import json
import unittest
from urllib.parse import quote

from app.services.douyin_adapter import (
    build_media_info,
    extract_page_item,
    extract_video_id,
    solve_challenge_cookie,
    supports_douyin_url,
)


class DouyinAdapterTestCase(unittest.TestCase):
    def test_recognizes_supported_hosts_without_matching_lookalikes(self) -> None:
        self.assertTrue(supports_douyin_url("https://v.douyin.com/example/"))
        self.assertTrue(supports_douyin_url("https://www.iesdouyin.com/share/video/123"))
        self.assertFalse(supports_douyin_url("https://douyin.com.example.test/video/123"))

    def test_extracts_video_id_from_path_query_or_page(self) -> None:
        self.assertEqual(extract_video_id("https://www.douyin.com/video/123456"), "123456")
        self.assertEqual(
            extract_video_id("https://www.douyin.com/?modal_id=987654"),
            "987654",
        )
        self.assertEqual(
            extract_video_id("https://v.douyin.com/example/", '<div data-aweme-id="246810"></div>'),
            "246810",
        )

    def test_extracts_item_from_encoded_render_data(self) -> None:
        item = self._build_item("13579")
        payload = {"app": {"detail": item}}
        page = (
            '<script id="RENDER_DATA" type="application/json">'
            f"{quote(json.dumps(payload, ensure_ascii=False))}"
            "</script>"
        )

        self.assertEqual(extract_page_item(page, "13579"), item)

    def test_extracts_item_from_router_data_with_braces_in_string(self) -> None:
        item = self._build_item("112233")
        payload = {
            "loaderData": {
                "video": {
                    "note": "字符串里的 } 不应截断 JSON",
                    "videoInfoRes": {"item_list": [item]},
                }
            }
        }
        page = f"<script>window._ROUTER_DATA = {json.dumps(payload, ensure_ascii=False)};</script>"

        self.assertEqual(extract_page_item(page, "112233"), item)

    def test_solves_page_challenge_without_exposing_the_cookie_value(self) -> None:
        prefix = b"public-test-prefix"
        answer = 42
        challenge = {
            "v": {
                "a": base64.b64encode(prefix).decode(),
                "c": base64.b64encode(
                    hashlib.sha256(prefix + str(answer).encode()).digest()
                ).decode(),
            }
        }
        blob = base64.b64encode(json.dumps(challenge).encode()).decode()
        page = f'<script>wci="verify_cookie",cs="{blob}"</script>'

        cookie = solve_challenge_cookie(page, search_limit=100)

        self.assertIsNotNone(cookie)
        cookie_name, encoded_value = str(cookie).split("=", 1)
        decoded_value = json.loads(base64.b64decode(encoded_value))
        self.assertEqual(cookie_name, "verify_cookie")
        self.assertEqual(base64.b64decode(decoded_value["d"]), b"42")

    def test_builds_normalized_media_info(self) -> None:
        item = self._build_item("445566")

        media = build_media_info(
            item,
            video_id="445566",
            source_url="https://v.douyin.com/example/",
            resolved_url="https://www.douyin.com/video/445566",
        )

        self.assertEqual(media.video_id, "445566")
        self.assertEqual(media.title, "公开测试视频")
        self.assertEqual(media.author, "测试作者")
        self.assertEqual(media.duration_seconds, 15)
        self.assertEqual(media.height, 1920)
        self.assertEqual(media.video_url, "https://media.example.test/play/video.mp4")

    @staticmethod
    def _build_item(video_id: str) -> dict[str, object]:
        return {
            "aweme_id": video_id,
            "desc": "公开测试视频",
            "author": {"nickname": "测试作者"},
            "video": {
                "duration": 15_000,
                "width": 1080,
                "height": 1920,
                "data_size": 1024,
                "cover": {"url_list": ["https://media.example.test/cover.jpg"]},
                "play_addr": {
                    "url_list": ["https://media.example.test/playwm/video.mp4"]
                },
            },
        }


if __name__ == "__main__":
    unittest.main()
