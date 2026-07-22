import unittest
from unittest.mock import patch

from app.services.xiaoyuzhou_service import (
    _build_shownotes_transcript,
    _fetch_episode_page,
)


class XiaoyuzhouServiceTests(unittest.TestCase):
    def test_build_shownotes_transcript_splits_readable_segments(self) -> None:
        """
        shownotes 应按段落进入前端展示，避免整段内容被塞进一条 00:00 字幕。
        """
        transcript = _build_shownotes_transcript(
            "第一段介绍本期主题。\n\n第二段列出嘉宾观点。\n第三段补充参考资料。"
        )

        self.assertEqual(transcript.plain_text.splitlines()[0], "第一段介绍本期主题。")
        self.assertEqual(
            [segment.text for segment in transcript.segments],
            ["第一段介绍本期主题。", "第二段列出嘉宾观点。", "第三段补充参考资料。"],
        )

    def test_fetch_episode_page_uses_shared_public_fetcher(self) -> None:
        """
        小宇宙页面读取必须复用公共抓取层，避免 urllib 在本机 HTTPS 链路上触发 TLS EOF。
        """
        with patch(
            "app.services.xiaoyuzhou_service.fetch_public_text",
            return_value="<html></html>",
        ) as fetch_public_text:
            page_html = _fetch_episode_page(
                "https://www.xiaoyuzhoufm.com/episode/example"
            )

        self.assertEqual(page_html, "<html></html>")
        fetch_public_text.assert_called_once()
        self.assertEqual(
            fetch_public_text.call_args.kwargs["accept_header"],
            "text/html,application/xhtml+xml,*/*",
        )


if __name__ == "__main__":
    unittest.main()
