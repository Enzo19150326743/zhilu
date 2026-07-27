import unittest

from app.schemas import TranscriptSegment
from app.services.transcript_segment_service import (
    SegmentNormalizationConfig,
    normalize_adjacent_segments,
)


class TranscriptSegmentServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = SegmentNormalizationConfig(
            max_seconds=8,
            max_characters=120,
            silence_gap_seconds=2,
        )

    def test_sentence_ending_flushes_pending_segments(self) -> None:
        normalized = normalize_adjacent_segments(
            [
                TranscriptSegment(start=0, end=1, text="这是第一部分"),
                TranscriptSegment(start=1, end=2, text="内容。"),
                TranscriptSegment(start=2, end=3, text="下一句"),
            ],
            config=self.config,
        )

        self.assertEqual([item.text for item in normalized], ["这是第一部分 内容。", "下一句"])
        self.assertEqual([(item.start, item.end) for item in normalized], [(0, 2), (2, 3)])

    def test_silence_and_speaker_changes_create_boundaries(self) -> None:
        normalized = normalize_adjacent_segments(
            [
                TranscriptSegment(start=0, end=1, text="主持内容", speaker="主持人"),
                TranscriptSegment(start=1, end=2, text="继续", speaker="主持人"),
                TranscriptSegment(start=4, end=5, text="停顿后", speaker="主持人"),
                TranscriptSegment(start=5, end=6, text="嘉宾回答", speaker="嘉宾"),
            ],
            config=self.config,
        )

        self.assertEqual(len(normalized), 3)
        self.assertEqual(normalized[0].text, "主持内容 继续")
        self.assertEqual(normalized[1].text, "停顿后")
        self.assertEqual(normalized[2].speaker, "嘉宾")

    def test_duration_and_character_limits_are_hard_boundaries(self) -> None:
        duration_limited = normalize_adjacent_segments(
            [
                TranscriptSegment(start=0, end=3, text="一"),
                TranscriptSegment(start=3, end=6, text="二"),
                TranscriptSegment(start=6, end=9, text="三"),
                TranscriptSegment(start=9, end=10, text="四"),
            ],
            config=self.config,
        )
        character_limited = normalize_adjacent_segments(
            [
                TranscriptSegment(start=0, end=1, text="甲" * 70),
                TranscriptSegment(start=1, end=2, text="乙" * 70),
                TranscriptSegment(start=2, end=3, text="丙"),
            ],
            config=self.config,
        )

        self.assertEqual([item.text for item in duration_limited], ["一 二 三", "四"])
        self.assertEqual(len(character_limited), 2)

    def test_short_sentences_wait_for_minimum_sentence_duration(self) -> None:
        normalized = normalize_adjacent_segments(
            [
                TranscriptSegment(start=0, end=1, text="第一句。"),
                TranscriptSegment(start=1, end=2, text="第二句。"),
                TranscriptSegment(start=2, end=4.5, text="第三句。"),
                TranscriptSegment(start=4.5, end=6, text="第四句。"),
            ],
            config=SegmentNormalizationConfig(
                max_seconds=8,
                max_characters=120,
                silence_gap_seconds=2,
                min_sentence_seconds=4,
            ),
        )

        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized[0].text, "第一句。 第二句。 第三句。")
        self.assertEqual((normalized[0].start, normalized[0].end), (0, 4.5))


if __name__ == "__main__":
    unittest.main()
