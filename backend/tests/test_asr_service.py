import tempfile
import unittest
import os
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.schemas import (
    TranscribeContextSettings,
    TranscribeSpeakerProfile,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services import asr_service
from app.services.sensevoice_service import SenseVoiceTranscriptionResult
from app.services.asr_service import transcribe_media_audio


class AsrServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        settings_patch = patch.dict(os.environ, {
            "ASR_CORRECTION_ENABLED": "0", "AI_API_KEY": "", "DEEPSEEK_API_KEY": "",
            "SENSEVOICE_SEGMENT_NORMALIZATION_ENABLED": "0",
        }, clear=False)
        settings_patch.start()
        self.addCleanup(settings_patch.stop)

    def test_saved_recognition_checkpoint_keeps_its_original_metadata(self) -> None:
        transcript = TranscriptPayload(
            segments=[TranscriptSegment(start=0, end=1, text="历史识别稿")],
            plain_text="历史识别稿",
        )
        recognized = asr_service.RecognizedTranscription(
            result=asr_service.AsrTranscriptionResult(
                transcript=transcript, model="archived-model", device="cpu",
                compute_type="int8", language="zh", engine="archived-engine",
            ),
            transcription_seconds=3,
        )
        response = asr_service.finalize_transcription(
            recognized,
            asr_service.PreparedTranscriptionMedia(path=Path("saved-checkpoint"), audio_download_seconds=2),
            source_url="https://example.com/archived",
        )
        self.assertEqual(response.transcript_variant_key, "archived_asr")
        self.assertEqual(response.transcript.asr_meta.engine, "archived-engine")
        self.assertEqual(response.transcript.raw_plain_text, "历史识别稿")

    def test_transcribe_media_audio_builds_payload_from_segments(self) -> None:
        """
        本地 ASR 结果必须转换成工作台统一的 TranscriptPayload，后续总结和 QA 才能复用。
        """
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            def fake_download(_: str) -> Path:
                return audio_path

            def fake_transcribe(_: Path) -> TranscriptPayload:
                return TranscriptPayload(
                    segments=[
                        TranscriptSegment(start=0, end=2.5, text="第一句内容。"),
                        TranscriptSegment(start=2.5, end=5, text="第二句内容。"),
                    ],
                    plain_text="第一句内容。 第二句内容。",
                )

            sensevoice_patch = patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                side_effect=lambda path, **_: SenseVoiceTranscriptionResult(
                    transcript=fake_transcribe(path), model="iic/SenseVoiceSmall", device="cpu"
                ),
            )
            sensevoice_patch.start()
            self.addCleanup(sensevoice_patch.stop)

            # NOTE: 全量测试可能由其他模块加载本机 .env；这里显式清空密钥，
            # 保证该用例只验证 ASR 载荷组装，不意外调用真实校对服务。
            with patch.dict(
                os.environ,
                {"AI_API_KEY": "", "DEEPSEEK_API_KEY": ""},
                clear=False,
            ):
                response = transcribe_media_audio(
                    "https://example.com/video",
                    audio_downloader=fake_download,
                )

        self.assertEqual(response.transcript.plain_text, "第一句内容。 第二句内容。")
        self.assertEqual(len(response.transcript.segments), 2)
        self.assertEqual(response.transcript.asr_meta.correction_status, "skipped")
        self.assertEqual(response.transcript.raw_plain_text, "第一句内容。 第二句内容。")

    def test_transcribe_media_audio_logs_stage_timings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            def fake_download(_: str) -> Path:
                return audio_path

            def fake_transcribe(_: Path) -> TranscriptPayload:
                return TranscriptPayload(
                    segments=[TranscriptSegment(start=0, end=1, text="敏感正文")],
                    plain_text="敏感正文",
                )

            sensevoice_patch = patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                side_effect=lambda path, **_: SenseVoiceTranscriptionResult(
                    transcript=fake_transcribe(path), model="iic/SenseVoiceSmall", device="cpu"
                ),
            )
            sensevoice_patch.start()
            self.addCleanup(sensevoice_patch.stop)

            with patch.dict(
                os.environ,
                {"AI_API_KEY": "", "DEEPSEEK_API_KEY": ""},
                clear=False,
            ):
                with self.assertLogs(
                    "app.services.asr_service",
                    level="INFO",
                ) as captured_logs:
                    transcribe_media_audio(
                        "https://example.com/private-video",
                        audio_downloader=fake_download,
                    )

        log_output = "\n".join(captured_logs.output)
        self.assertIn("stage=audio_download", log_output)
        self.assertIn("stage=sensevoice", log_output)
        self.assertIn("stage=correction", log_output)
        self.assertIn("stage=total", log_output)
        self.assertNotIn("https://example.com/private-video", log_output)
        self.assertNotIn("敏感正文", log_output)

    def test_transcribe_media_audio_removes_temporary_audio(self) -> None:
        """
        ASR 使用临时音频文件，完成后应清理，避免本地数据目录持续膨胀。
        """
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            def fake_download(_: str) -> Path:
                return audio_path

            def fake_transcribe(_: Path) -> TranscriptPayload:
                return TranscriptPayload(segments=[], plain_text="文本")

            sensevoice_patch = patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                side_effect=lambda path, **_: SenseVoiceTranscriptionResult(
                    transcript=fake_transcribe(path), model="iic/SenseVoiceSmall", device="cpu"
                ),
            )
            sensevoice_patch.start()
            self.addCleanup(sensevoice_patch.stop)

            with patch("app.services.asr_service._remove_file") as remove_file:
                transcribe_media_audio(
                    "https://example.com/video",
                    audio_downloader=fake_download,
                )

        remove_file.assert_called_once_with(audio_path)


    def test_transcribe_media_audio_persists_context_settings_in_asr_meta(self) -> None:
        """
        转写设置需要写入 asr_meta，历史重开时才能说明这份稿件的整理依据。
        """
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            def fake_download(_: str) -> Path:
                return audio_path

            def fake_transcribe(_: Path) -> TranscriptPayload:
                return TranscriptPayload(
                    segments=[TranscriptSegment(start=0, end=2, text="访谈内容。")],
                    plain_text="访谈内容。",
                )

            sensevoice_patch = patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                side_effect=lambda path, **_: SenseVoiceTranscriptionResult(
                    transcript=fake_transcribe(path), model="iic/SenseVoiceSmall", device="cpu"
                ),
            )
            sensevoice_patch.start()
            self.addCleanup(sensevoice_patch.stop)

            response = transcribe_media_audio(
                "https://example.com/video",
                audio_downloader=fake_download,
                context_settings=TranscribeContextSettings(
                    program_structure="interview",
                    content_tags=["ai_tech"],
                    speakers=[
                        TranscribeSpeakerProfile(name="主持人", role="主持人"),
                        TranscribeSpeakerProfile(name="嘉宾", role="嘉宾"),
                    ],
                    correction_terms=["DeepSeek", "Cursor"],
                ),
                media_platform="bilibili",
                media_type="video",
            )

        self.assertIsNotNone(response.transcript.asr_meta)
        self.assertEqual(response.transcript.asr_meta.program_structure, "interview")
        self.assertEqual(response.transcript.asr_meta.content_tags, ["ai_tech"])
        self.assertEqual(
            response.transcript.asr_meta.correction_terms,
            ["DeepSeek", "Cursor"],
        )
        self.assertEqual(response.transcript.asr_meta.correction_term_count, 2)
        self.assertEqual(response.transcript.asr_meta.glossary_term_count, 0)
        self.assertEqual(
            [speaker.name for speaker in response.transcript.asr_meta.speaker_profiles],
            ["主持人", "嘉宾"],
        )

    def test_shownotes_extraction_failure_does_not_block_asr(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            def fake_download(_: str) -> Path:
                return audio_path

            def fake_transcribe(_: Path) -> TranscriptPayload:
                return TranscriptPayload(
                    segments=[TranscriptSegment(start=0, end=2, text="转写仍然完成。")],
                    plain_text="转写仍然完成。",
                )

            sensevoice_patch = patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                side_effect=lambda path, **_: SenseVoiceTranscriptionResult(
                    transcript=fake_transcribe(path), model="iic/SenseVoiceSmall", device="cpu"
                ),
            )
            sensevoice_patch.start()
            self.addCleanup(sensevoice_patch.stop)

            with patch(
                "app.services.asr_service.extract_shownotes_context",
                side_effect=ValueError("invalid JSON"),
            ) as extract_mock:
                with patch.dict(
                    os.environ,
                    {
                        "ASR_CORRECTION_ENABLED": "0",
                        "AI_API_KEY": "",
                        "DEEPSEEK_API_KEY": "",
                    },
                    clear=False,
                ):
                    response = transcribe_media_audio(
                        "https://example.com/podcast",
                        audio_downloader=fake_download,

                        shownotes_plain_text="主持人和嘉宾信息",
                    )

        self.assertEqual(response.transcript.plain_text, "转写仍然完成。")
        self.assertIsNone(response.shownotes_context)
        extract_mock.assert_called_once()

    def test_platform_rejected_audio_download_uses_specific_error(self) -> None:
        """
        B 站音频流接口被拒绝时，应说明是音频流未拿到，而不是笼统提示未公开。
        """
        with self.assertRaises(HTTPException) as raised:
            asr_service._raise_audio_download_error(
                OSError("HTTP Error 412: Precondition Failed")
            )

        self.assertEqual(
            raised.exception.detail["error_code"],
            "ASR_AUDIO_PLATFORM_REJECTED",
        )
        self.assertIn("没有拿到可用于本地转写 的音频文件", raised.exception.detail["message"])


if __name__ == "__main__":
    unittest.main()
