import unittest

from app.main import normalize_public_video_url


class UrlNormalizationTests(unittest.TestCase):
    def test_bilibili_tracking_query_is_removed_before_parse(self) -> None:
        """
        B 站分享链接里的跟踪参数不应传入 yt-dlp，避免增加平台拒绝概率。
        """
        raw_url = (
            "https://www.bilibili.com/video/BV1ZvEt6oEWR/"
            "?spm_id_from=333.1007.tianma.2-2-5.click"
            "&vd_source=8a07796c0cf76ea6322c706c2e7ccafc"
        )

        normalized_url = normalize_public_video_url(raw_url)

        self.assertEqual(
            normalized_url,
            "https://www.bilibili.com/video/BV1ZvEt6oEWR",
        )

    def test_bilibili_playback_query_is_preserved(self) -> None:
        """
        多 P 或起播时间属于播放定位信息，清理跟踪参数时需要保留。
        """
        raw_url = (
            "https://www.bilibili.com/video/BV1ZvEt6oEWR"
            "?p=2&t=33&spm_id_from=333.1007"
        )

        normalized_url = normalize_public_video_url(raw_url)

        self.assertEqual(
            normalized_url,
            "https://www.bilibili.com/video/BV1ZvEt6oEWR?p=2&t=33",
        )


if __name__ == "__main__":
    unittest.main()
