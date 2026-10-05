import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas import (
    ParseResponse,
    SummarizeResponse,
    TranscribeResponse,
    TranscriptAsrMeta,
    TranscriptPayload,
    TranscriptSegment,
    VideoSummary,
)
from app.services import library_service
from app.services.asr_service import (
    PreparedTranscriptionMedia,
    RecognizedTranscription,
    WhisperTranscriptionResult,
)
from app.services.task_runner import TaskRunner
from app.services.task_store import TaskStore
from app.services.execution_lock import ExecutionLock


def build_detail(source_url: str, *, transcript: bool = False) -> ParseResponse:
    video_id = source_url.rsplit("/", 1)[-1]
    return ParseResponse.model_validate(
        {
            "source_url": source_url,
            "is_placeholder": False,
            "video": {
                "video_id": video_id,
                "platform": "test",
                "url": source_url,
                "title": f"视频 {video_id}",
                "author": "作者",
                "duration": 60,
                "thumbnail": "",
                "has_transcript": transcript,
                "media_type": "video",
                "text_source_type": "asr_transcript" if transcript else "content",
            },
            "formats": [],
            "transcript": {
                "segments": ([{"start": 0, "end": 1, "text": "正文"}] if transcript else []),
                "plain_text": "正文" if transcript else "",
            },
            "summary": {
                "tldr": "",
                "key_points": [],
                "timeline": [],
                "structured_analysis_markdown": "",
                "takeaways": [],
            },
            "mindmap_markdown": "",
            "library_summary_status": "none",
        }
    )


class TaskRunnerTests(unittest.TestCase):
    def test_single_long_transcript_persists_and_summarizes_with_live_scheduler(self) -> None:
        """单条长音频复用真实内容库与调度器；只有外部识别和 AI 调用被替代。"""
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "library.sqlite3"
            with patch.object(library_service, "DATABASE_PATH", database_path):
                detail = build_detail("https://example.com/long-podcast")
                library_service.upsert_library_item(detail)
                store = TaskStore(database_path)
                batch_id = store.create_batch(
                    client_request_id="single-long-podcast",
                    urls=[detail.source_url],
                    target="analyze",
                    settings={"asr_engine": "sensevoice_small"},
                )
                segments = [
                    TranscriptSegment(
                        start=index * 8,
                        end=(index + 1) * 8,
                        text=f"第{index}段长音频正文，验证识别结果保存与后台任务调度能同时运行，不遗漏内容。",
                    )
                    for index in range(1163)
                ]
                transcript = TranscriptPayload(
                    segments=segments,
                    plain_text="\n".join(segment.text for segment in segments),
                    raw_segments=segments,
                    raw_plain_text="\n".join(segment.text for segment in segments),
                    asr_meta=TranscriptAsrMeta(
                        engine="sensevoice-small",
                        model="test-model",
                        device="cpu",
                        compute_type="test",
                        correction_status="skipped",
                    ),
                )
                recognized = RecognizedTranscription(
                    result=WhisperTranscriptionResult(
                        transcript=transcript,
                        model="test-model",
                        device="cpu",
                        compute_type="test",
                        language="zh",
                    ),
                    transcription_seconds=1,
                )
                response = TranscribeResponse(
                    transcript=transcript,
                    transcript_variant_key="sensevoice_small",
                    source_url=detail.source_url,
                    video_id=detail.video.video_id,
                    message="测试转写稿已生成",
                )
                summary = SummarizeResponse(
                    summary=VideoSummary(
                        tldr="长音频总结已保存",
                        key_points=[],
                        timeline=[],
                        structured_analysis_markdown="## 长音频总结",
                        takeaways=[],
                    ),
                    mindmap_markdown="# 长音频总结",
                    is_ai_generated=True,
                    model="test-model",
                )

                def prepare(_url, task_dir, **_kwargs):
                    task_dir.mkdir(parents=True, exist_ok=True)
                    media_path = task_dir / "audio.m4a"
                    media_path.write_bytes(b"synthetic audio")
                    return PreparedTranscriptionMedia(path=media_path, audio_download_seconds=1)

                runner = TaskRunner(
                    store, poll_seconds=0.005, task_root=Path(directory) / "tasks"
                )
                runner._execution_lock = ExecutionLock(Path(directory) / "runner.lock")
                with (
                    patch("app.services.task_runner.resolve_transcription_media", return_value=(detail.source_url, None, None)),
                    patch("app.services.task_runner.prepare_transcription_media", side_effect=prepare),
                    patch("app.services.task_runner.recognize_transcription_media", return_value=recognized),
                    patch("app.services.task_runner.finalize_transcription", return_value=response),
                    patch("app.services.processing_service.summarize_transcript", return_value=summary),
                    patch("app.services.task_runner.check_and_increment_rate_limit", return_value=SimpleNamespace(allowed=True)),
                ):
                    runner.start()
                    try:
                        deadline = time.monotonic() + 10
                        while time.monotonic() < deadline:
                            snapshot = store.get_batch(batch_id)
                            if snapshot["stats"]["active"] == 0:
                                break
                            time.sleep(0.02)
                        for future in tuple(runner._futures):
                            future.result(timeout=2)
                    finally:
                        runner.stop()

                snapshot = store.get_batch(batch_id)
                persisted = library_service.get_library_detail(detail.video.video_id)

            self.assertEqual(snapshot["stats"]["succeeded"], 1, snapshot["items"])
            self.assertEqual(len(persisted.transcript.segments), 1163)
            self.assertEqual(persisted.transcript.plain_text, transcript.plain_text)
            self.assertEqual(persisted.transcript.raw_plain_text, transcript.raw_plain_text)
            self.assertEqual(persisted.library_summary_status, "ai_generated")
            self.assertEqual(persisted.summary.tldr, "长音频总结已保存")

    def test_one_parse_failure_does_not_block_remaining_items(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = TaskStore(Path(directory) / "tasks.sqlite3")
            batch_id = store.create_batch(
                client_request_id="runner-failure-request",
                urls=[f"https://example.com/{index}" for index in range(5)],
                target="parse_only",
                settings={"asr_engine": "local_whisper", "context_settings": None},
            )

            def parse(url: str):
                if url.endswith("/2"):
                    raise RuntimeError("synthetic failure")
                return build_detail(url)

            runner = TaskRunner(
                store,
                worker_count=3,
                poll_seconds=0.005,
                task_root=Path(directory) / "task-media",
            )
            runner._execution_lock = ExecutionLock(Path(directory) / "runner.lock")
            with (
                patch("app.services.task_runner.get_library_detail_by_source_url", return_value=None),
                patch("app.services.task_runner.parse_and_persist", side_effect=parse),
                patch("app.services.task_runner.check_and_increment_rate_limit", return_value=SimpleNamespace(allowed=True)),
            ):
                runner.start()
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    snapshot = store.get_batch(batch_id)
                    if snapshot and snapshot["stats"]["active"] == 0:
                        break
                    time.sleep(0.02)
                runner.stop()

            snapshot = store.get_batch(batch_id)
            self.assertEqual(snapshot["stats"]["succeeded"], 4)
            self.assertEqual(snapshot["stats"]["failed"], 1)

    def test_pipeline_is_bounded_and_download_overlaps_recognition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = TaskStore(Path(directory) / "tasks.sqlite3")
            batch_id = store.create_batch(
                client_request_id="runner-overlap-request",
                urls=[f"https://example.com/{index}" for index in range(8)],
                target="analyze",
                settings={"asr_engine": "local_whisper", "context_settings": None},
            )
            lock = threading.Lock()
            active = {"download": 0, "recognize": 0}
            peaks = {"download": 0, "recognize": 0}
            intervals: dict[str, list[tuple[float, float]]] = {"download": [], "recognize": []}

            def timed(stage, delay, result_factory):
                def run(*args, **kwargs):
                    started = time.monotonic()
                    with lock:
                        active[stage] += 1
                        peaks[stage] = max(peaks[stage], active[stage])
                    time.sleep(delay)
                    result = result_factory(*args, **kwargs)
                    finished = time.monotonic()
                    with lock:
                        active[stage] -= 1
                        intervals[stage].append((started, finished))
                    return result
                return run

            def prepared(_url, output_dir, **_kwargs):
                output_dir.mkdir(parents=True, exist_ok=True)
                path = output_dir / "audio.mp3"
                path.write_bytes(b"audio")
                return PreparedTranscriptionMedia(path=path, audio_download_seconds=0.02)

            def recognized(prepared_media, **_kwargs):
                return RecognizedTranscription(
                    result=WhisperTranscriptionResult(
                        transcript=TranscriptPayload(segments=[], plain_text="原始稿"),
                        model="fake",
                        device="cpu",
                        compute_type="int8",
                        language="zh",
                    ),
                    transcription_seconds=0.04,
                )

            runner = TaskRunner(
                store,
                worker_count=4,
                poll_seconds=0.005,
                task_root=Path(directory) / "task-media",
            )
            runner._execution_lock = ExecutionLock(Path(directory) / "runner.lock")
            with (
                patch("app.services.task_runner.parse_and_persist", side_effect=lambda url: build_detail(url)),
                patch("app.services.task_runner.get_library_detail_by_source_url", return_value=None),
                patch("app.services.task_runner.get_library_detail", return_value=None),
                patch("app.services.task_runner.resolve_transcription_media", side_effect=lambda detail: (detail.source_url, None, None)),
                patch("app.services.task_runner.prepare_transcription_media", side_effect=timed("download", 0.03, prepared)),
                patch("app.services.task_runner.recognize_transcription_media", side_effect=timed("recognize", 0.05, recognized)),
                patch("app.services.task_runner.finalize_transcription", return_value=SimpleNamespace()),
                patch("app.services.task_runner.persist_transcription", side_effect=lambda detail, _response: build_detail(detail.source_url, transcript=True)),
                patch("app.services.task_runner.summarize_and_persist", side_effect=lambda detail: (detail, SimpleNamespace(is_ai_generated=True))),
                patch("app.services.task_runner.check_and_increment_rate_limit", return_value=SimpleNamespace(allowed=True)),
            ):
                runner.start()
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    snapshot = store.get_batch(batch_id)
                    if snapshot and snapshot["stats"]["succeeded"] == 8:
                        break
                    time.sleep(0.02)
                runner.stop()

            snapshot = store.get_batch(batch_id)
            self.assertEqual(snapshot["stats"]["succeeded"], 8)
            self.assertLessEqual(peaks["download"], 2)
            self.assertEqual(peaks["recognize"], 1)
            self.assertTrue(
                any(ds < re and rs < de for ds, de in intervals["download"] for rs, re in intervals["recognize"]),
                "下载与识别阶段应存在真实时间重叠",
            )


if __name__ == "__main__":
    unittest.main()
