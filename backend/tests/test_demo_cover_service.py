import unittest

from app.services.demo_cover_service import resolve_demo_cover_url


class DemoCoverServiceTests(unittest.TestCase):
    def test_stable_remote_cover_is_reused(self) -> None:
        demo = {
            "thumbnail": "https://cdn.example.com/stable-cover.jpg",
            "video": {
                "platform": "bilibili",
                "url": "https://www.bilibili.com/video/BV1EXAMPLE",
            },
        }

        self.assertEqual(
            resolve_demo_cover_url(demo),
            "https://cdn.example.com/stable-cover.jpg",
        )

    def test_signed_douyin_cover_is_refreshed_from_source_page(self) -> None:
        demo = {
            "thumbnail": (
                "https://signed.example.com/cover.webp"
                "?x-expires=1785672000&x-signature=temporary"
            ),
            "video": {
                "platform": "douyin",
                "url": "https://www.douyin.com/video/1234567890",
            },
        }
        calls: list[str] = []

        def resolve_douyin_thumbnail(source_url: str) -> str:
            calls.append(source_url)
            return "https://signed.example.com/refreshed-cover.webp"

        self.assertEqual(
            resolve_demo_cover_url(
                demo,
                douyin_thumbnail_resolver=resolve_douyin_thumbnail,
            ),
            "https://signed.example.com/refreshed-cover.webp",
        )
        self.assertEqual(calls, ["https://www.douyin.com/video/1234567890"])

    def test_missing_cover_without_supported_source_returns_empty(self) -> None:
        demo = {
            "thumbnail": "",
            "video": {
                "platform": "example",
                "url": "https://example.com/media",
            },
        }

        self.assertEqual(resolve_demo_cover_url(demo), "")


if __name__ == "__main__":
    unittest.main()
