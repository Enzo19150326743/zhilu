import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.schemas import (
    TranscribeContextSettings,
    TranscribeSpeakerProfile,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services import asr_service, fun_asr_service
from app.services.fun_asr_service import (
    FunAsrAudioChunk,
    FunAsrConfig,
    FunAsrContext,
    FunAsrError,
    FunAsrTranscriptionResult,
)


class FunAsrServiceTests(unittest.TestCase):
    def test_context_is_truncated_to_official_limit(self) -> None:
        context_text = fun_asr_service.build_fun_asr_context_text(
            FunAsrContext(
                title="很长的节目标题" * 30,
                author="测试作者",
                platform="xiaoyuzhou",
                media_type="podcast",
                context_settings=TranscribeContextSettings(
                    program_structure="interview",
                    content_tags=["ai_tech", "product"],
                    speakers=[
                        TranscribeSpeakerProfile(name="主持人", role="主持人"),
                        TranscribeSpeakerProfile(name="嘉宾", role="研究员"),
                    ],
                ),
            ),
            [f"术语{index}" for index in range(120)],
        )

        self.assertLessEqual(len(context_text), 400)
        self.assertIn("标题", context_text)
        self.assertIn("xiaoyuzhou", context_text.lower())

    def test_response_uses_word_timestamps_to_remove_overlap(self) -> None:
        payload = {
            "output": {
                "sentence": {
                    "sentence_end": True,
                    "begin_time": 500,
                    "end_time": 2800,
                    "text": "重复内容保留内容",
                    "words": [
                        {
                            "begin_time": 500,
                            "end_time": 1500,
                            "text": "重复内容",
                            "punctuation": "，",
                        },
                        {
                            "begin_time": 2100,
                            "end_time": 2800,
                            "text": "保留内容",
                            "punctuation": "。",
                        },
                    ],
                }
            }
        }
        response_body = f"data:{json.dumps(payload, ensure_ascii=False)}\n\n".encode()
        chunk = FunAsrAudioChunk(
            index=1,
            path=Path("unused.opus"),
            start=268,
            duration=270,
            overlap_seconds=2,
        )

        segments = fun_asr_service._parse_fun_asr_response(response_body, chunk)

        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].text, "保留内容。")
        self.assertAlmostEqual(segments[0].start, 270.1)
        self.assertAlmostEqual(segments[0].end, 270.8)

    def test_chunks_are_merged_by_index_even_when_requests_finish_out_of_order(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            audio_path = output_dir / "source.m4a"
            audio_path.write_bytes(b"audio")
            chunks = [
                FunAsrAudioChunk(0, output_dir / "0.opus", 0, 270, 0),
                FunAsrAudioChunk(1, output_dir / "1.opus", 268, 120, 2),
            ]
            for chunk in chunks:
                chunk.path.write_bytes(b"chunk")

            def fake_requester(
                chunk: FunAsrAudioChunk,
                _: str,
                __: FunAsrConfig,
            ) -> list[TranscriptSegment]:
                if chunk.index == 0:
                    time.sleep(0.02)
                return [
                    TranscriptSegment(
                        start=chunk.start,
                        end=chunk.start + 1,
                        text=f"第{chunk.index + 1}段",
                    )
                ]

            with patch.dict(
                os.environ,
                {"DASHSCOPE_API_KEY": "test-key"},
                clear=False,
            ):
                result = fun_asr_service.transcribe_audio_with_fun_asr(
                    audio_path,
                    glossary_terms=[],
                    context=FunAsrContext(),
                    output_dir=output_dir,
                    chunk_preparer=lambda *_: chunks,
                    requester=fake_requester,
                )

        self.assertEqual(result.transcript.plain_text, "第1段 第2段")
        self.assertEqual(result.chunk_count, 2)

    def test_empty_cloud_chunk_is_reported_instead_of_silently_dropped(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            audio_path = output_dir / "source.m4a"
            chunk_path = output_dir / "0.opus"
            audio_path.write_bytes(b"audio")
            chunk_path.write_bytes(b"chunk")
            chunks = [FunAsrAudioChunk(0, chunk_path, 0, 120, 0)]

            with patch.dict(
                os.environ,
                {"DASHSCOPE_API_KEY": "test-key"},
                clear=False,
            ):
                with self.assertRaises(FunAsrError) as captured:
                    fun_asr_service.transcribe_audio_with_fun_asr(
                        audio_path,
                        glossary_terms=[],
                        context=FunAsrContext(),
                        output_dir=output_dir,
                        chunk_preparer=lambda *_: chunks,
                        requester=lambda *_: [],
                    )

        self.assertEqual(captured.exception.error_code, "FUN_ASR_EMPTY_CHUNK")
        self.assertIn("第 1/1 段", captured.exception.message)

    def test_chunk_preparation_uses_270_seconds_with_two_second_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            audio_path = output_dir / "source.webm"
            audio_path.write_bytes(b"audio")

            def fake_run(
                command: list[str],
                *,
                error_code: str,
                message: str,
            ) -> object:
                del error_code, message
                output_path = Path(command[-1])
                if output_path.suffix == ".opus":
                    output_path.write_bytes(b"opus")
                return type("Completed", (), {"stdout": ""})()

            with patch(
                "app.services.fun_asr_service._resolve_media_tool",
                side_effect=lambda tool: tool,
            ):
                with patch(
                    "app.services.fun_asr_service._run_media_command",
                    side_effect=fake_run,
                ):
                    with patch(
                        "app.services.fun_asr_service._probe_duration",
                        return_value=600,
                    ):
                        chunks = fun_asr_service.prepare_fun_asr_audio_chunks(
                            audio_path,
                            output_dir,
                        )

        self.assertEqual([chunk.start for chunk in chunks], [0, 268, 536])
        self.assertEqual([chunk.duration for chunk in chunks], [270, 270, 64])
        self.assertEqual([chunk.overlap_seconds for chunk in chunks], [0, 2, 2])

    def test_cloud_failure_never_calls_local_whisper(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "source.mp4"
            audio_path.write_bytes(b"audio")

            with patch(
                "app.services.asr_service.transcribe_audio_with_fun_asr",
                side_effect=FunAsrError(
                    "FUN_ASR_REQUEST_FAILED",
                    "云端请求失败。",
                ),
            ):
                with patch(
                    "app.services.asr_service._transcribe_audio_with_whisper"
                ) as local_whisper:
                    with self.assertRaises(HTTPException) as captured:
                        asr_service.transcribe_media_audio(
                            "https://example.com/video",
                            audio_downloader=lambda _: audio_path,
                            asr_engine="fun_asr_flash",
                        )

        local_whisper.assert_not_called()
        self.assertEqual(
            captured.exception.detail["error_code"],
            "FUN_ASR_REQUEST_FAILED",
        )

    def test_cloud_result_keeps_provider_and_correction_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "source.m4a"
            audio_path.write_bytes(b"audio")
            cloud_result = FunAsrTranscriptionResult(
                transcript=TranscriptPayload(
                    segments=[TranscriptSegment(start=0, end=2, text="云端结果")],
                    plain_text="云端结果",
                ),
                model="fun-asr-flash-2026-06-15",
                provider="aliyun",
                chunk_count=1,
                timestamp_source="fun-asr-word",
            )

            with patch(
                "app.services.asr_service.transcribe_audio_with_fun_asr",
                return_value=cloud_result,
            ):
                with patch.dict(
                    os.environ,
                    {"AI_API_KEY": "", "DEEPSEEK_API_KEY": ""},
                    clear=False,
                ):
                    response = asr_service.transcribe_media_audio(
                        "https://example.com/audio",
                        audio_downloader=lambda _: audio_path,
                        asr_engine="fun_asr_flash",
                    )

        self.assertEqual(response.transcript.asr_meta.engine, "fun-asr-flash")
        self.assertEqual(response.transcript.asr_meta.provider, "aliyun")
        self.assertEqual(response.transcript.asr_meta.chunk_count, 1)
        self.assertEqual(
            response.transcript.asr_meta.cloud_correction_status,
            "skipped",
        )
        self.assertIn("Fun-ASR-Flash", response.message)


if __name__ == "__main__":
    unittest.main()
