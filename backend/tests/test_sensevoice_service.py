import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.services import asr_service, sensevoice_service
from app.services.sensevoice_service import (
    SenseVoiceConfig,
    SenseVoiceError,
    SenseVoiceTranscriptionResult,
)
from app.schemas import TranscriptPayload, TranscriptSegment


class SenseVoiceServiceTests(unittest.TestCase):
    def test_sentence_info_maps_to_sorted_transcript_segments(self) -> None:
        segments = sensevoice_service._parse_sensevoice_segments(
            [
                {
                    "sentence_info": [
                        {"start": 2200, "end": 3900, "text": " 第二句。 "},
                        {"start": 100, "end": 1800, "sentence": "第一句。"},
                    ]
                }
            ],
            postprocessor=lambda text: text,
        )

        self.assertEqual([segment.text for segment in segments], ["第一句。", "第二句。"])
        self.assertEqual([segment.start for segment in segments], [0.1, 2.2])
        self.assertEqual([segment.end for segment in segments], [1.8, 3.9])

    def test_auto_device_falls_back_to_cpu_within_same_engine(self) -> None:
        attempted_devices: list[str] = []

        class FakeModel:
            def __init__(self, device: str) -> None:
                self.device = device

            def generate(self, **_: object) -> list[dict[str, object]]:
                if self.device == "cuda:0":
                    raise RuntimeError("out of memory")
                return [
                    {
                        "sentence_info": [
                            {"start": 0, "end": 1000, "text": "CPU 结果。"}
                        ]
                    }
                ]

        def fake_factory(config: SenseVoiceConfig) -> FakeModel:
            attempted_devices.append(config.device)
            return FakeModel(config.device)

        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "source.m4a"
            normalized_path = Path(temporary_directory) / "normalized.wav"
            audio_path.write_bytes(b"audio")
            normalized_path.write_bytes(b"wav")
            with patch(
                "app.services.sensevoice_service._prepare_sensevoice_audio",
                return_value=normalized_path,
            ):
                with patch(
                    "app.services.sensevoice_service._resolve_device_candidates",
                    return_value=["cuda:0", "cpu"],
                ):
                    result = sensevoice_service.transcribe_audio_with_sensevoice(
                        audio_path,
                        output_dir=Path(temporary_directory),
                        config=SenseVoiceConfig(
                            model="iic/SenseVoiceSmall",
                            device="auto",
                        ),
                        model_factory=fake_factory,
                        postprocessor=lambda text: text,
                    )

        self.assertEqual(attempted_devices, ["cuda:0", "cpu"])
        self.assertEqual(result.device, "cpu")
        self.assertEqual(result.transcript.plain_text, "CPU 结果。")

    def test_missing_sentence_timestamps_fails_explicitly(self) -> None:
        with self.assertRaises(ValueError):
            sensevoice_service._parse_sensevoice_segments(
                [{"text": "只有全文，没有时间片段。"}],
                postprocessor=lambda text: text,
            )

    def test_word_timestamps_build_sentence_segments_without_punc_model(self) -> None:
        segments = sensevoice_service._parse_sensevoice_segments(
            [
                {
                    "text": "<|zh|><|Speech|>第一句。第二句！",
                    "words": ["第", "一", "句", "。", "第", "二", "句", "！"],
                    "timestamp": [
                        [0, 80],
                        [90, 170],
                        [180, 260],
                        [260, 320],
                        [400, 480],
                        [490, 570],
                        [580, 660],
                        [660, 720],
                    ],
                }
            ],
            postprocessor=lambda text: text,
        )

        self.assertEqual([segment.text for segment in segments], ["第一句。", "第二句！"])
        self.assertEqual([segment.start for segment in segments], [0.0, 0.4])
        self.assertEqual([segment.end for segment in segments], [0.32, 0.72])

    def test_asr_service_returns_sensevoice_metadata_without_whisper_fallback(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "source.webm"
            audio_path.write_bytes(b"audio")
            sensevoice_result = SenseVoiceTranscriptionResult(
                transcript=TranscriptPayload(
                    segments=[TranscriptSegment(start=0, end=2, text="本地结果。")],
                    plain_text="本地结果。",
                ),
                model="iic/SenseVoiceSmall",
                device="cpu",
            )

            with patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                return_value=sensevoice_result,
            ):
                with patch(
                    "app.services.asr_service._transcribe_audio_with_whisper"
                ) as whisper:
                    with patch.dict(
                        os.environ,
                        {"AI_API_KEY": "", "DEEPSEEK_API_KEY": ""},
                        clear=False,
                    ):
                        response = asr_service.transcribe_media_audio(
                            "https://example.com/video",
                            audio_downloader=lambda _: audio_path,
                            asr_engine="sensevoice_small",
                        )

        whisper.assert_not_called()
        self.assertEqual(response.transcript_variant_key, "sensevoice_small")
        self.assertEqual(response.transcript.asr_meta.engine, "sensevoice-small")
        self.assertEqual(response.transcript.asr_meta.device, "cpu")
        self.assertIsNotNone(response.transcript.asr_meta.transcription_seconds)
        self.assertIn("SenseVoiceSmall", response.message)

    def test_sensevoice_failure_does_not_call_whisper(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "source.mp4"
            audio_path.write_bytes(b"audio")
            with patch(
                "app.services.asr_service.transcribe_audio_with_sensevoice",
                side_effect=SenseVoiceError(
                    "SENSEVOICE_MODEL_FAILED",
                    "SenseVoice 失败。",
                ),
            ):
                with patch(
                    "app.services.asr_service._transcribe_audio_with_whisper"
                ) as whisper:
                    with self.assertRaises(HTTPException):
                        asr_service.transcribe_media_audio(
                            "https://example.com/video",
                            audio_downloader=lambda _: audio_path,
                            asr_engine="sensevoice_small",
                        )

        whisper.assert_not_called()


if __name__ == "__main__":
    unittest.main()
