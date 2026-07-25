import unittest

from app.schemas import SummarizeRequest


class SummarizeRequestSchemaTests(unittest.TestCase):
    def test_long_video_title_is_normalized_before_validation(self) -> None:
        request = SummarizeRequest(
            transcript_plain_text="有效转写稿",
            video_title=f"  {'题' * 688}  ",
        )

        self.assertEqual(len(request.video_title or ""), 300)
        self.assertEqual(request.video_title, "题" * 300)

    def test_blank_video_title_becomes_none(self) -> None:
        request = SummarizeRequest(
            transcript_plain_text="有效转写稿",
            video_title="   ",
        )

        self.assertIsNone(request.video_title)


if __name__ == "__main__":
    unittest.main()
