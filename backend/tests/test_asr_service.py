import tempfile
import unittest
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.schemas import (
    TranscribeContextSettings,
    TranscribeSpeakerProfile,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services import asr_service
from app.services.asr_service import transcribe_media_audio


class AsrServiceTests(unittest.TestCase):
    def test_whisper_activates_project_cuda_runtime_before_model_loading(self) -> None:
        """项目内 NVIDIA DLL 必须在 Whisper 模型构造前加入当前进程搜索路径。"""
        events: list[str] = []

        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            class FakeSegment:
                start = 0
                end = 1
                text = "测试转写"

            class FakeWhisperModel:
                def __init__(
                    self,
                    _: str,
                    *,
                    device: str,
                    compute_type: str,
                ) -> None:
                    events.append(f"model:{device}:{compute_type}")

                def transcribe(
                    self,
                    _: str,
                    **__: object,
                ) -> tuple[list[FakeSegment], object]:
                    return [FakeSegment()], object()

            fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
            env = {
                "ASR_WHISPER_MODEL": "base",
                "ASR_FALLBACK_WHISPER_MODEL": "base",
                "ASR_DEVICE": "cpu",
                "ASR_COMPUTE_TYPE": "int8",
                "ASR_AUTO_FALLBACK": "0",
            }

            with patch.dict(sys.modules, {"faster_whisper": fake_module}):
                with patch.dict(os.environ, env, clear=False):
                    with patch(
                        "app.services.cuda_runtime.activate_cuda_dll_directories",
                        side_effect=lambda: events.append("activate"),
                    ):
                        asr_service._transcribe_audio_with_whisper(audio_path)

        self.assertEqual(events, ["activate", "model:cpu:int8"])

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
                    transcriber=fake_transcribe,
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
                        transcriber=fake_transcribe,
                    )

        log_output = "\n".join(captured_logs.output)
        self.assertIn("stage=audio_download", log_output)
        self.assertIn("stage=whisper", log_output)
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

            with patch("app.services.asr_service._remove_file") as remove_file:
                transcribe_media_audio(
                    "https://example.com/video",
                    audio_downloader=fake_download,
                    transcriber=fake_transcribe,
                )

        remove_file.assert_called_once_with(audio_path)

    def test_auto_device_falls_back_without_injecting_semantic_whisper_prompt(
        self,
    ) -> None:
        """
        ASR_DEVICE=auto 时先试 CUDA；失败后继续使用 CPU，但不向声学解码注入长语义上下文。
        """
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            class FakeSegment:
                start = 0
                end = 1.5
                text = " Deep seek 和 codex "

            class FakeWhisperModel:
                init_calls: list[tuple[str, str, str]] = []
                transcribe_kwargs: dict[str, object] = {}

                def __init__(
                    self,
                    model: str,
                    *,
                    device: str,
                    compute_type: str,
                ) -> None:
                    self.model = model
                    self.device = device
                    self.compute_type = compute_type
                    self.init_calls.append((model, device, compute_type))
                    if device == "cuda":
                        raise RuntimeError("cuda unavailable")

                def transcribe(
                    self,
                    _: str,
                    **kwargs: object,
                ) -> tuple[list[FakeSegment], object]:
                    self.transcribe_kwargs = kwargs
                    FakeWhisperModel.transcribe_kwargs = kwargs
                    return [FakeSegment()], object()

            fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
            env = {
                "ASR_WHISPER_MODEL": "large-v3-turbo",
                "ASR_FALLBACK_WHISPER_MODEL": "base",
                "ASR_DEVICE": "auto",
                "ASR_COMPUTE_TYPE": "int8",
                "ASR_LANGUAGE": "zh",
                "ASR_BEAM_SIZE": "5",
                "ASR_AUTO_FALLBACK": "1",
            }

            with patch.dict(sys.modules, {"faster_whisper": fake_module}):
                with patch.dict(os.environ, env, clear=False):
                    result = asr_service._transcribe_audio_with_whisper(
                        audio_path,
                    )

        self.assertEqual(
            FakeWhisperModel.init_calls,
            [
                ("large-v3-turbo", "cuda", "int8"),
                ("base", "cpu", "int8"),
            ],
        )
        self.assertEqual(result.model, "base")
        self.assertEqual(result.device, "cpu")
        self.assertEqual(FakeWhisperModel.transcribe_kwargs["language"], "zh")
        self.assertEqual(FakeWhisperModel.transcribe_kwargs["beam_size"], 5)
        self.assertIsNone(FakeWhisperModel.transcribe_kwargs["initial_prompt"])
        self.assertIsNone(FakeWhisperModel.transcribe_kwargs["hotwords"])
        self.assertTrue(FakeWhisperModel.transcribe_kwargs["condition_on_previous_text"])

    def test_whisper_decode_excludes_semantic_context_to_prevent_repetition(self) -> None:
        """
        标题、术语和说话人仍供 DeepSeek 校对使用，但不能污染 Whisper 声学解码。
        """
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            class FakeSegment:
                start = 0
                end = 1.5
                text = " 老王 说到了 deep seek "

            class FakeWhisperModel:
                transcribe_kwargs: dict[str, object] = {}

                def __init__(
                    self,
                    model: str,
                    *,
                    device: str,
                    compute_type: str,
                ) -> None:
                    self.model = model
                    self.device = device
                    self.compute_type = compute_type

                def transcribe(
                    self,
                    _: str,
                    **kwargs: object,
                ) -> tuple[list[FakeSegment], object]:
                    FakeWhisperModel.transcribe_kwargs = kwargs
                    return [FakeSegment()], object()

            fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
            with patch.dict(sys.modules, {"faster_whisper": fake_module}):
                result = asr_service._transcribe_audio_with_whisper(
                    audio_path,
                    asr_config=asr_service.AsrConfig(
                        model="base",
                        fallback_model="base",
                        device="cpu",
                        compute_type="int8",
                        language="zh",
                        beam_size=5,
                        auto_fallback=False,
                    ),
                )

        self.assertEqual(result.model, "base")
        self.assertIsNone(FakeWhisperModel.transcribe_kwargs["initial_prompt"])
        self.assertIsNone(FakeWhisperModel.transcribe_kwargs["hotwords"])
        self.assertTrue(FakeWhisperModel.transcribe_kwargs["condition_on_previous_text"])

    def test_whisper_normalizes_correction_segments_and_preserves_raw_segments(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "sample.m4a"
            audio_path.write_text("fake audio", encoding="utf-8")

            class FakeWhisperModel:
                def __init__(self, *_: object, **__: object) -> None:
                    pass

                def transcribe(
                    self,
                    _: str,
                    **__: object,
                ) -> tuple[list[SimpleNamespace], object]:
                    return (
                        [
                            SimpleNamespace(start=0, end=1.5, text="第一段"),
                            SimpleNamespace(start=1.5, end=3, text="第二段"),
                            SimpleNamespace(start=3, end=4.5, text="第三段"),
                            SimpleNamespace(start=4.5, end=6, text="第四段"),
                        ],
                        object(),
                    )

            fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
            env = {
                "ASR_DEVICE": "cpu",
                "ASR_AUTO_FALLBACK": "0",
                "ASR_WHISPER_SEGMENT_NORMALIZATION_ENABLED": "1",
                "ASR_WHISPER_SEGMENT_MAX_SECONDS": "4",
                "ASR_WHISPER_SEGMENT_MAX_CHARACTERS": "120",
                "ASR_WHISPER_SEGMENT_SILENCE_GAP_SECONDS": "2",
            }
            with patch.dict(sys.modules, {"faster_whisper": fake_module}):
                with patch.dict(os.environ, env, clear=False):
                    result = asr_service._transcribe_audio_with_whisper(audio_path)

        self.assertEqual(len(result.transcript.segments), 2)
        self.assertEqual(result.transcript.segments[0].text, "第一段 第二段 第三段")
        self.assertIsNotNone(result.raw_transcript)
        self.assertEqual(len(result.raw_transcript.segments), 4)
        self.assertEqual(result.timestamp_source, "whisper-segment-normalized")

    def test_whisper_segment_normalization_can_be_disabled(self) -> None:
        raw_segments = [
            TranscriptSegment(start=0, end=1, text="第一段"),
            TranscriptSegment(start=1, end=2, text="第二段"),
        ]
        with patch.dict(
            os.environ,
            {"ASR_WHISPER_SEGMENT_NORMALIZATION_ENABLED": "0"},
            clear=False,
        ):
            normalized = asr_service._normalize_whisper_segments(raw_segments)

        self.assertEqual(len(normalized), 2)
        self.assertEqual([item.text for item in normalized], ["第一段", "第二段"])

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
                transcriber=fake_transcribe,
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
                        transcriber=fake_transcribe,
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
        self.assertIn("没有拿到可交给 Whisper 的音频文件", raised.exception.detail["message"])


if __name__ == "__main__":
    unittest.main()
