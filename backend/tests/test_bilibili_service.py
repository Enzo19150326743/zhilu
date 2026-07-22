import unittest

from app.services import bilibili_service


def _video_stream(
    *,
    format_id: str,
    codec: str,
    height: int,
    bandwidth: int,
) -> bilibili_service.BilibiliVideoStream:
    return bilibili_service.BilibiliVideoStream(
        format_id=format_id,
        url=f"https://example.com/{format_id}",
        urls=(f"https://example.com/{format_id}",),
        extension="mp4",
        codec=codec,
        quality=80 if height == 1080 else 64,
        width=1920 if height == 1080 else 1280,
        height=height,
        bandwidth=bandwidth,
        filesize=None,
        description=f"{height}P",
    )


def _audio_stream(
    *,
    format_id: str,
    bandwidth: int,
) -> bilibili_service.BilibiliAudioStream:
    return bilibili_service.BilibiliAudioStream(
        format_id=format_id,
        url=f"https://example.com/{format_id}",
        urls=(f"https://example.com/{format_id}",),
        extension="m4a",
        codec="mp4a.40.2",
        bandwidth=bandwidth,
        filesize=None,
    )


class BilibiliFormatDisplayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.audio_low = _audio_stream(format_id="audio-low", bandwidth=64_000)
        self.audio_high = _audio_stream(format_id="audio-high", bandwidth=128_000)
        self.video_streams = [
            _video_stream(
                format_id="1080-av1",
                codec="av01.0.08m.08",
                height=1080,
                bandwidth=2_400_000,
            ),
            _video_stream(
                format_id="1080-hevc",
                codec="hev1.1.6.l120.90",
                height=1080,
                bandwidth=2_200_000,
            ),
            _video_stream(
                format_id="1080-avc",
                codec="avc1.640028",
                height=1080,
                bandwidth=2_000_000,
            ),
            _video_stream(
                format_id="720-hevc",
                codec="hev1.1.6.l120.90",
                height=720,
                bandwidth=1_200_000,
            ),
            _video_stream(
                format_id="720-av1",
                codec="av01.0.05m.08",
                height=720,
                bandwidth=1_400_000,
            ),
        ]
        self.video = bilibili_service.BilibiliVideo(
            bvid="BV1TEST00000",
            aid=1,
            cid=2,
            source_url="https://www.bilibili.com/video/BV1TEST00000",
            title="测试视频",
            author="测试作者",
            duration=120,
            thumbnail="https://example.com/cover.jpg",
            audio=self.audio_high,
            audio_streams=[self.audio_low, self.audio_high],
            video_streams=self.video_streams,
            cookie_header="",
        )

    def test_display_formats_keep_one_compatible_stream_per_resolution(self) -> None:
        formats = bilibili_service._build_format_items(self.video)

        video_formats = [item for item in formats if item["vcodec"] != "none"]
        audio_formats = [item for item in formats if item["vcodec"] == "none"]

        self.assertEqual(
            [item["format_id"] for item in video_formats],
            ["1080-avc", "720-hevc"],
        )
        self.assertEqual(
            [item["resolution"] for item in video_formats],
            ["1080p", "720p"],
        )
        self.assertEqual(
            [item["format_id"] for item in audio_formats],
            ["audio-high"],
        )

    def test_best_video_uses_same_compatibility_priority(self) -> None:
        selected = bilibili_service._select_best_video_stream(self.video_streams)

        self.assertEqual(selected.format_id, "1080-avc")


if __name__ == "__main__":
    unittest.main()
