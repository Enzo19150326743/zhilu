import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.main import proxy_public_image


class ImageProxyTests(unittest.TestCase):
    def test_image_proxy_returns_public_image_bytes(self) -> None:
        """
        封面图应通过后端公共图片代理返回，避免浏览器直连远端图片失败。
        """
        with patch(
            "app.services.http_fetch_service.fetch_public_bytes",
            return_value=(b"fake-png", "image/png"),
        ) as fetch_public_bytes:
            response = proxy_public_image("https://image.xyzcdn.net/example.png")

        self.assertEqual(response.body, b"fake-png")
        self.assertEqual(response.media_type, "image/png")
        self.assertEqual(
            response.headers["Cache-Control"],
            "public, max-age=86400",
        )
        self.assertEqual(
            fetch_public_bytes.call_args.kwargs["accept_header"],
            "image/avif,image/webp,image/apng,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
        )

    def test_image_proxy_rejects_non_image_content_type(self) -> None:
        """
        图片代理不能把任意 HTML 或 JSON 作为图片回传给前端。
        """
        with patch(
            "app.services.http_fetch_service.fetch_public_bytes",
            return_value=(b"<html></html>", "text/html"),
        ):
            with self.assertRaises(HTTPException) as raised:
                proxy_public_image("https://example.com/page")

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(
            raised.exception.detail["error_code"],
            "IMAGE_PROXY_INVALID_TYPE",
        )


if __name__ == "__main__":
    unittest.main()
