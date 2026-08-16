import unittest

from app.schemas import (
    ShownotesContext,
    ShownotesSpeaker,
    TranscribeContextSettings,
    TranscribeRequest,
    TranscribeSpeakerProfile,
    TranscriptSegment,
)
from app.services.transcribe_context_service import (
    build_correction_context_lines,
    build_whisper_context_lines,
    merge_shownotes_context,
    normalize_transcribe_context_settings,
)


class TranscribeContextServiceTests(unittest.TestCase):
    def test_shownotes_replaces_system_speaker_placeholders(self) -> None:
        merged = merge_shownotes_context(
            TranscribeContextSettings(
                program_structure="auto",
                speakers=[
                    TranscribeSpeakerProfile(name="主持人", role="主持人"),
                    TranscribeSpeakerProfile(name="嘉宾", role="嘉宾"),
                ],
                correction_terms=["用户术语"],
            ),
            ShownotesContext(
                program_structure="interview",
                speakers=[
                    ShownotesSpeaker(name="泓君", role="主持人", confidence="high"),
                    ShownotesSpeaker(name="朋新宇", role="嘉宾", confidence="high"),
                ],
                terms=["FDE", "用户术语"],
            ),
        )

        self.assertEqual(merged.program_structure, "interview")
        self.assertEqual([speaker.name for speaker in merged.speakers], ["泓君", "朋新宇"])
        self.assertEqual(merged.correction_terms, ["用户术语", "FDE"])

    def test_manual_speaker_name_is_not_overridden_by_ai(self) -> None:
        merged = merge_shownotes_context(
            TranscribeContextSettings(
                program_structure="interview",
                speakers=[TranscribeSpeakerProfile(name="用户填写的主持人", role="主持人")],
            ),
            ShownotesContext(
                program_structure="interview",
                speakers=[ShownotesSpeaker(name="泓君", role="主持人", confidence="high")],
            ),
        )

        self.assertEqual(merged.speakers[0].name, "用户填写的主持人")

    def test_low_confidence_speaker_keeps_role_only(self) -> None:
        merged = merge_shownotes_context(
            None,
            ShownotesContext(
                program_structure="interview",
                speakers=[ShownotesSpeaker(name="不确定的人", role="嘉宾", confidence="low")],
            ),
        )

        self.assertEqual(merged.speakers[0].name, "嘉宾")

    def test_transcribe_request_keeps_legacy_body_compatible(self) -> None:
        """
        旧前端只传 url / video_id 时仍必须通过校验，避免破坏同步转写入口。
        """
        request = TranscribeRequest.model_validate(
            {
                "url": "https://example.com/video",
                "video_id": "demo_001",
            }
        )

        self.assertIsNone(request.context_settings)

    def test_transcribe_request_accepts_context_settings(self) -> None:
        request = TranscribeRequest.model_validate(
            {
                "url": "https://example.com/video",
                "context_settings": {
                    "program_structure": "interview",
                    "content_tags": ["ai_tech", "product_business"],
                    "speakers": [
                        {
                            "name": "主持人",
                            "role": "主持人",
                            "description": "主要负责提问和串场。",
                        },
                        {
                            "name": "嘉宾",
                            "role": "嘉宾",
                            "description": "主要回答行业观点。",
                        },
                    ],
                },
            }
        )

        self.assertEqual(request.context_settings.program_structure, "interview")
        self.assertEqual(
            request.context_settings.content_tags,
            ["ai_tech", "product_business"],
        )
        self.assertEqual(request.context_settings.speakers[0].name, "主持人")

    def test_transcript_segment_accepts_optional_speaker(self) -> None:
        segment = TranscriptSegment(
            start=0,
            end=2,
            speaker="主持人",
            text="欢迎来到节目。",
        )

        self.assertEqual(segment.speaker, "主持人")

    def test_xiaoyuzhou_podcast_defaults_to_auto_and_keeps_podcast_context(
        self,
    ) -> None:
        settings = normalize_transcribe_context_settings(
            None,
            platform="xiaoyuzhou",
            media_type="podcast",
        )

        self.assertEqual(settings.program_structure, "auto")
        self.assertEqual(settings.content_tags, [])
        self.assertTrue(
            any("播客" in line for line in build_correction_context_lines(settings))
        )

    def test_douyin_defaults_to_solo(self) -> None:
        settings = normalize_transcribe_context_settings(
            None,
            platform="douyin",
            media_type="video",
        )

        self.assertEqual(settings.program_structure, "solo")

    def test_unknown_content_tags_are_ignored(self) -> None:
        settings = normalize_transcribe_context_settings(
            TranscribeContextSettings(
                program_structure="interview",
                content_tags=["ai_tech", "unknown_tag", "product_business"],
            ),
            platform="bilibili",
            media_type="video",
        )

        self.assertEqual(settings.content_tags, ["ai_tech", "product_business"])

    def test_empty_speakers_are_removed(self) -> None:
        settings = normalize_transcribe_context_settings(
            TranscribeContextSettings(
                program_structure="auto",
                speakers=[
                    TranscribeSpeakerProfile(name=" ", role="", description=None),
                    TranscribeSpeakerProfile(name="嘉宾", role="嘉宾"),
                ],
            ),
            platform="bilibili",
            media_type="video",
        )

        self.assertEqual(len(settings.speakers), 1)
        self.assertEqual(settings.speakers[0].name, "嘉宾")

    def test_interview_defaults_to_host_and_guest_speakers(self) -> None:
        settings = normalize_transcribe_context_settings(
            TranscribeContextSettings(program_structure="interview"),
            platform="bilibili",
            media_type="video",
        )

        self.assertEqual([speaker.name for speaker in settings.speakers], ["主持人", "嘉宾"])

    def test_whisper_context_contains_program_tags_and_speaker_names(self) -> None:
        settings = normalize_transcribe_context_settings(
            TranscribeContextSettings(
                program_structure="interview",
                content_tags=["ai_tech"],
                speakers=[TranscribeSpeakerProfile(name="老王", role="嘉宾")],
            ),
            platform="bilibili",
            media_type="video",
        )

        prompt_text = "\n".join(build_whisper_context_lines(settings))

        self.assertIn("双人访谈", prompt_text)
        self.assertIn("AI / 科技", prompt_text)
        self.assertIn("老王", prompt_text)


if __name__ == "__main__":
    unittest.main()
