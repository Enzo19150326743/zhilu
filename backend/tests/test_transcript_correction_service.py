import json
import os
import unittest
from unittest.mock import patch

from app.schemas import (
    TranscribeContextSettings,
    TranscribeSpeakerProfile,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services import transcript_correction_service
from app.services.transcript_correction_service import (
    TranscriptCorrectionContext,
    correct_transcript_payload,
)


class TranscriptCorrectionServiceTests(unittest.TestCase):
    def test_3500_characters_is_a_batch_size_not_a_read_limit(self) -> None:
        unique_tail = "全文校对尾部标记"
        transcript = _build_transcript(
            "甲" * 1000,
            "乙" * 1000,
            "丙" * 1000,
            "丁" * 1000,
            f"戊{unique_tail}",
        )
        requested_batches: list[list[str]] = []

        def fake_requester(indexed_segments: object, *_: object) -> str:
            indexed_list = list(indexed_segments)  # type: ignore[arg-type]
            requested_batches.append([segment.text for _, segment in indexed_list])
            return json.dumps(
                {
                    "segments": [
                        {"index": index, "text": segment.text}
                        for index, segment in indexed_list
                    ]
                },
                ensure_ascii=False,
            )

        with patch.dict(
            os.environ,
            {
                "ASR_CORRECTION_ENABLED": "1",
                "ASR_CORRECTION_CHUNK_CHARS": "3500",
            },
            clear=False,
        ):
            result = correct_transcript_payload(
                transcript,
                glossary_terms=[],
                requester=fake_requester,
            )

        self.assertEqual(result.status, "corrected")
        self.assertGreater(len(requested_batches), 1)
        self.assertTrue(
            any(unique_tail in text for batch in requested_batches for text in batch)
        )
        self.assertIn(unique_tail, result.transcript.plain_text)

    def test_correction_success_preserves_timestamps_and_updates_text(self) -> None:
        """
        DeepSeek 只允许改文本，时间戳必须由原始 ASR 片段回填。
        """
        transcript = _build_transcript("deep seek 今天发布了新功能。")

        def fake_requester(*_: object) -> str:
            return '{"segments":[{"index":0,"text":"DeepSeek 今天发布了新功能。"}]}'

        with patch.dict(os.environ, {"ASR_CORRECTION_ENABLED": "1"}, clear=False):
            result = correct_transcript_payload(
                transcript,
                glossary_terms=["DeepSeek"],
                context=TranscriptCorrectionContext(title="AI 新闻"),
                requester=fake_requester,
            )

        self.assertEqual(result.status, "corrected")
        self.assertEqual(result.transcript.segments[0].start, 0)
        self.assertEqual(result.transcript.segments[0].end, 2)
        self.assertEqual(result.transcript.plain_text, "DeepSeek 今天发布了新功能。")

    def test_correction_skips_without_api_key(self) -> None:
        """
        没配置 DeepSeek Key 时必须使用原始稿，不能阻断转写。
        """
        with patch.dict(
            os.environ,
            {"ASR_CORRECTION_ENABLED": "1", "DEEPSEEK_API_KEY": ""},
            clear=False,
        ):
            result = correct_transcript_payload(
                _build_transcript("原始文本。"),
                glossary_terms=[],
            )

        self.assertEqual(result.status, "skipped")
        self.assertEqual(result.transcript.plain_text, "原始文本。")

    def test_invalid_json_falls_back_to_raw_transcript(self) -> None:
        """
        模型返回非 JSON 时，该次校对失败但原始稿仍可用。
        """
        transcript = _build_transcript("原始文本。")

        def fake_requester(*_: object) -> str:
            return "不是 JSON"

        result = correct_transcript_payload(
            transcript,
            glossary_terms=[],
            requester=fake_requester,
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.transcript.plain_text, "原始文本。")

    def test_segment_index_mismatch_falls_back_to_raw_chunk(self) -> None:
        """
        返回 index 缺失或片段数量不匹配时，不能错位覆盖时间戳文本。
        """
        transcript = _build_transcript("第一段。", "第二段。")

        def fake_requester(*_: object) -> str:
            return '{"segments":[{"index":0,"text":"第一段校对。"}]}'

        result = correct_transcript_payload(
            transcript,
            glossary_terms=[],
            requester=fake_requester,
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.transcript.plain_text, "第一段。 第二段。")

    def test_invalid_large_chunk_retries_as_smaller_chunks(self) -> None:
        """
        大块校对输出被截断时，应自动拆成小块重试，避免整条稿件回退原始稿。
        """
        transcript = _build_transcript("第一段。", "第二段。", "第三段。", "第四段。")
        requested_chunk_lengths: list[int] = []

        def fake_requester(indexed_segments: object, *_: object) -> str:
            indexed_list = list(indexed_segments)  # type: ignore[arg-type]
            requested_chunk_lengths.append(len(indexed_list))
            if len(indexed_list) > 2:
                return '{"segments":['

            segment_json = ",".join(
                (
                    f'{{"index":{index},"text":"{segment.text.rstrip("。")}校对。"}}'
                    for index, segment in indexed_list
                )
            )
            return f'{{"segments":[{segment_json}]}}'

        result = correct_transcript_payload(
            transcript,
            glossary_terms=[],
            requester=fake_requester,
        )

        self.assertEqual(result.status, "corrected")
        self.assertEqual(requested_chunk_lengths, [4, 2, 2])
        self.assertEqual(
            result.transcript.plain_text,
            "第一段校对。 第二段校对。 第三段校对。 第四段校对。",
        )

    def test_length_finish_reason_is_treated_as_truncated_response(self) -> None:
        """
        DeepSeek 明确返回 length 时，说明 JSON 可能被截断，不能继续按正常内容解析。
        """
        with self.assertRaisesRegex(ValueError, "truncated"):
            transcript_correction_service._extract_deepseek_message_content(
                {
                    "choices": [
                        {
                            "finish_reason": "length",
                            "message": {"content": '{"segments":['},
                        }
                    ]
                }
            )

    def test_correction_writes_allowed_speaker_to_segment(self) -> None:
        """
        DeepSeek 返回允许的 speaker 时，只写入文本标签，不改变时间戳和片段顺序。
        """
        transcript = _build_transcript("你怎么看这个方向？", "我认为值得继续观察。")

        def fake_requester(*_: object) -> str:
            return (
                '{"segments":['
                '{"index":0,"speaker":"主持人","text":"你怎么看这个方向？"},'
                '{"index":1,"speaker":"嘉宾","text":"我认为值得继续观察。"}'
                "]}"
            )

        result = correct_transcript_payload(
            transcript,
            glossary_terms=[],
            context=TranscriptCorrectionContext(
                title="AI 访谈",
                context_settings=TranscribeContextSettings(
                    program_structure="interview",
                    speakers=[
                        TranscribeSpeakerProfile(name="主持人", role="主持人"),
                        TranscribeSpeakerProfile(name="嘉宾", role="嘉宾"),
                    ],
                ),
            ),
            requester=fake_requester,
        )

        self.assertEqual(result.status, "corrected")
        self.assertEqual(result.transcript.segments[0].speaker, "主持人")
        self.assertEqual(result.transcript.segments[1].speaker, "嘉宾")
        self.assertEqual(
            result.transcript.plain_text,
            "主持人：你怎么看这个方向？ 嘉宾：我认为值得继续观察。",
        )

    def test_unknown_speaker_is_ignored_without_failing_chunk(self) -> None:
        transcript = _build_transcript("这句话不确定是谁说的。")

        def fake_requester(*_: object) -> str:
            return (
                '{"segments":['
                '{"index":0,"speaker":"不存在的人","text":"这句话不确定是谁说的。"}'
                "]}"
            )

        result = correct_transcript_payload(
            transcript,
            glossary_terms=[],
            context=TranscriptCorrectionContext(
                context_settings=TranscribeContextSettings(
                    program_structure="interview",
                    speakers=[TranscribeSpeakerProfile(name="主持人", role="主持人")],
                ),
            ),
            requester=fake_requester,
        )

        self.assertEqual(result.status, "corrected")
        self.assertIsNone(result.transcript.segments[0].speaker)
        self.assertEqual(result.transcript.plain_text, "这句话不确定是谁说的。")

    def test_solo_program_structure_disables_speaker_label(self) -> None:
        transcript = _build_transcript("今天我来分享一个方法。")

        def fake_requester(*_: object) -> str:
            return (
                '{"segments":['
                '{"index":0,"speaker":"讲者","text":"今天我来分享一个方法。"}'
                "]}"
            )

        result = correct_transcript_payload(
            transcript,
            glossary_terms=[],
            context=TranscriptCorrectionContext(
                context_settings=TranscribeContextSettings(
                    program_structure="solo",
                    speakers=[TranscribeSpeakerProfile(name="讲者", role="讲者")],
                ),
            ),
            requester=fake_requester,
        )

        self.assertIsNone(result.transcript.segments[0].speaker)

    def test_correction_prompt_contains_speaker_context(self) -> None:
        prompt = transcript_correction_service._build_correction_prompt(
            [(0, TranscriptSegment(start=0, end=2, text="你好。"))],
            glossary_terms=["DeepSeek"],
            context=TranscriptCorrectionContext(
                title="AI 访谈",
                context_settings=TranscribeContextSettings(
                    program_structure="interview",
                    content_tags=["ai_tech"],
                    speakers=[
                        TranscribeSpeakerProfile(
                            name="主持人",
                            role="主持人",
                            description="主要负责提问和串场。",
                        ),
                        TranscribeSpeakerProfile(
                            name="嘉宾",
                            role="嘉宾",
                            description="主要回答行业观点。",
                        ),
                    ],
                ),
            ),
        )

        self.assertIn("双人访谈", prompt)
        self.assertIn("AI / 科技", prompt)
        self.assertIn("主持人", prompt)
        self.assertIn("主要负责提问和串场", prompt)
        self.assertIn("不确定是谁说的", prompt)


def _build_transcript(*texts: str) -> TranscriptPayload:
    segments = [
        TranscriptSegment(start=float(index * 2), end=float(index * 2 + 2), text=text)
        for index, text in enumerate(texts)
    ]
    return TranscriptPayload(
        segments=segments,
        plain_text=" ".join(texts),
    )


if __name__ == "__main__":
    unittest.main()
