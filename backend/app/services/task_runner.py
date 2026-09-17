"""单进程、有界并发的持久化任务调度器。"""

from __future__ import annotations

import logging
import shutil
import threading
import os
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from contextlib import contextmanager

from fastapi import HTTPException

from app.schemas import TranscribeContextSettings
from app.services.asr_service import (
    PreparedTranscriptionMedia,
    RecognizedTranscription,
    WhisperTranscriptionResult,
    finalize_transcription,
    prepare_transcription_media,
    recognize_transcription_media,
)
from app.services.processing_service import (
    has_complete_summary,
    has_full_transcript,
    parse_and_persist,
    persist_transcription,
    resolve_transcription_media,
    summarize_and_persist,
    task_identity,
)
from app.services.processing_resources import (
    AI_WORK_SLOTS,
    DOWNLOAD_SLOTS,
    RECOGNITION_SLOT,
)
from app.services.task_store import TaskStore
from app.services.library_service import get_library_detail, get_library_detail_by_source_url
from app.services.execution_lock import ExecutionLock
from app.services.rate_limit_service import check_and_increment_rate_limit

logger = logging.getLogger(__name__)


class TaskRunner:
    def __init__(
        self,
        store: TaskStore,
        *,
        worker_count: int = 4,
        poll_seconds: float = 0.25,
        task_root: Path | None = None,
    ):
        self.store = store
        self.worker_count = worker_count
        self.poll_seconds = poll_seconds
        self.task_root = task_root or (Path(__file__).resolve().parents[2] / "data" / "tasks")
        self.parse_slots = threading.BoundedSemaphore(2)
        self.download_slots = DOWNLOAD_SLOTS
        self.recognition_slot = RECOGNITION_SLOT
        self.ai_slots = AI_WORK_SLOTS
        self._executor = ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="processing-task")
        self._futures: set[Future[None]] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._content_locks: dict[str, threading.Lock] = {}
        self._content_locks_guard = threading.Lock()
        self._execution_lock = ExecutionLock(
            Path(__file__).resolve().parents[2] / "data" / "processing-runner.lock"
        )

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._execution_lock.acquire()
        try:
            self.store.recover_interrupted()
        except Exception:
            self._execution_lock.release()
            raise
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="task-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        self._executor.shutdown(wait=False, cancel_futures=False)
        if not any(not future.done() for future in self._futures):
            self._execution_lock.release()

    def _loop(self) -> None:
        while not self._stop.is_set():
            self.store.promote_due_retries()
            self._futures = {future for future in self._futures if not future.done()}
            while len(self._futures) < self.worker_count and not self._stop.is_set():
                task = self.store.claim_next()
                if task is None:
                    break
                future = self._executor.submit(self._execute, task)
                future.add_done_callback(self._on_future_done)
                self._futures.add(future)
            self._stop.wait(self.poll_seconds)

    def _execute(self, task: dict) -> None:
        task_id = str(task["id"])
        token = str(task["execution_token"])
        try:
            self.store.update_running(task_id, token, stage="parse")
            settings = task.get("settings") or {}
            cached_detail = get_library_detail_by_source_url(str(task["source_url"]))
            if cached_detail is None and not self._consume_rate_limit(
                task_id, token, settings, "parse"
            ):
                return
            with self.parse_slots:
                detail = parse_and_persist(str(task["source_url"]))
            if not self.store.update_running(task_id, token, **task_identity(detail)):
                return
            if task["target"] == "parse_only":
                self.store.finish(task_id, token)
                return

            content_key = task_identity(detail)["content_key"]
            with self._content_lock(content_key):
                canonical = get_library_detail(detail.video.video_id)
                if canonical is not None:
                    detail = canonical
                self._execute_analysis(task, task_id, token, detail)
        except HTTPException as error:
            detail = error.detail if isinstance(error.detail, dict) else {}
            self.store.fail(
                task_id,
                token,
                str(detail.get("error_code") or "PROCESSING_FAILED"),
                str(detail.get("message") or error.detail or "处理失败。"),
            )
        except Exception as error:
            logger.exception("processing task failed: task_id=%s", task_id)
            self.store.fail(task_id, token, "PROCESSING_FAILED", _safe_error_message(error))

    def _on_future_done(self, _: Future[None]) -> None:
        if self._stop.is_set() and all(future.done() for future in self._futures):
            self._execution_lock.release()

    def _execute_analysis(self, task: dict, task_id: str, token: str, detail) -> None:
        try:

            settings = task.get("settings") or {}
            if not has_full_transcript(detail):
                if not self._consume_rate_limit(task_id, token, settings, "transcribe"):
                    return
                context_payload = settings.get("context_settings")
                context_settings = TranscribeContextSettings.model_validate(context_payload) if context_payload else None
                checkpoint = dict(task.get("checkpoint") or {})
                task_dir = self.task_root / task_id
                recognition_payload = checkpoint.get("recognition")
                if recognition_payload:
                    recognized = _deserialize_recognized(recognition_payload)
                    prepared = PreparedTranscriptionMedia(
                        path=task_dir / "recovered-media",
                        audio_download_seconds=float(checkpoint.get("audio_download_seconds", 0)),
                    )
                else:
                    self.store.update_running(task_id, token, stage="download")
                    task_dir.parent.mkdir(parents=True, exist_ok=True)
                    free_bytes = shutil.disk_usage(task_dir.parent).free
                    if free_bytes < 512 * 1024 * 1024:
                        raise RuntimeError("磁盘可用空间不足 512 MB，无法准备转写媒体。")
                    transcription_url, headers, factory = resolve_transcription_media(detail)
                    with self.download_slots:
                        prepared = prepare_transcription_media(
                            transcription_url,
                            task_dir,
                            http_headers=headers,
                            audio_downloader_factory=factory,
                        )
                    checkpoint["audio_download_seconds"] = prepared.audio_download_seconds
                    checkpoint["media_path"] = str(prepared.path)
                    self.store.update_running(task_id, token, stage="recognize", checkpoint_json=checkpoint)
                    with self.recognition_slot:
                        recognized = recognize_transcription_media(
                            prepared,
                            asr_engine=settings.get("asr_engine", "local_whisper"),
                        )
                    checkpoint["recognition"] = _serialize_recognized(recognized)
                    self.store.update_running(task_id, token, stage="correct", checkpoint_json=checkpoint)
                checkpoint["ai_inflight"] = "correct"
                self.store.update_running(task_id, token, stage="correct", checkpoint_json=checkpoint)
                with self.ai_slots:
                    response = finalize_transcription(
                        recognized,
                        prepared,
                        source_url=detail.source_url,
                        video_id=detail.video.video_id,
                        media_title=detail.video.title,
                        media_author=detail.video.author,
                        media_platform=detail.video.platform,
                        media_type=detail.video.media_type,
                        context_settings=context_settings,
                        shownotes_plain_text=detail.shownotes_plain_text,
                        asr_engine=settings.get("asr_engine", "local_whisper"),
                    )
                detail = persist_transcription(detail, response)
                checkpoint.pop("ai_inflight", None)
                self.store.update_running(task_id, token, stage="summarize", checkpoint_json=checkpoint)
                try:
                    if prepared.path.is_file() and task_dir.resolve() in prepared.path.resolve().parents:
                        prepared.path.unlink()
                except OSError:
                    logger.warning("failed to remove task media: task_id=%s", task_id)

            warning = None
            if not has_complete_summary(detail):
                if not self._consume_rate_limit(task_id, token, settings, "summarize"):
                    return
                checkpoint = dict(task.get("checkpoint") or {})
                checkpoint["ai_inflight"] = "summarize"
                self.store.update_running(task_id, token, stage="summarize", checkpoint_json=checkpoint)
                with self.ai_slots:
                    detail, summary_response = summarize_and_persist(detail)
                if not summary_response.is_ai_generated:
                    warning = "AI 总结不可用，已保存本地降级结果。"
            self.store.finish(task_id, token, warning=warning)
        except Exception:
            raise

    @contextmanager
    def _content_lock(self, content_key: str):
        with self._content_locks_guard:
            lock = self._content_locks.setdefault(content_key, threading.Lock())
        lock.acquire()
        try:
            yield
        finally:
            lock.release()

    def _consume_rate_limit(self, task_id: str, token: str, settings: dict, action: str) -> bool:
        limit = int(os.getenv(f"{action.upper()}_RATE_LIMIT_PER_HOUR", "50"))
        result = check_and_increment_rate_limit(
            client_key=str(settings.get("client_key") or "local"),
            action=action,
            limit=max(1, limit),
        )
        if result.allowed:
            return True
        self.store.defer_until(
            task_id,
            token,
            result.item.reset_at,
            f"{action} 本地额度已用完，将在 {result.item.reset_at} 后继续。",
        )
        return False


_store: TaskStore | None = None
_runner: TaskRunner | None = None


def get_task_store() -> TaskStore:
    global _store
    if _store is None:
        _store = TaskStore()
    return _store


def start_task_runner() -> None:
    global _runner
    if _runner is None:
        _runner = TaskRunner(get_task_store())
    _runner.start()


def stop_task_runner() -> None:
    if _runner is not None:
        _runner.stop()


def _serialize_recognized(recognized: RecognizedTranscription) -> dict:
    result = recognized.result
    return {
        "transcription_seconds": recognized.transcription_seconds,
        "result": {
            "transcript": result.transcript.model_dump(mode="json"),
            "model": result.model,
            "device": result.device,
            "compute_type": result.compute_type,
            "language": result.language,
            "engine": result.engine,
            "provider": result.provider,
            "chunk_count": result.chunk_count,
            "timestamp_source": result.timestamp_source,
            "raw_transcript": result.raw_transcript.model_dump(mode="json") if result.raw_transcript else None,
        },
    }


def _deserialize_recognized(payload: dict) -> RecognizedTranscription:
    from app.schemas import TranscriptPayload

    result = payload["result"]
    return RecognizedTranscription(
        result=WhisperTranscriptionResult(
            transcript=TranscriptPayload.model_validate(result["transcript"]),
            model=result["model"],
            device=result["device"],
            compute_type=result["compute_type"],
            language=result.get("language"),
            engine=result.get("engine", "faster-whisper"),
            provider=result.get("provider"),
            chunk_count=result.get("chunk_count"),
            timestamp_source=result.get("timestamp_source"),
            raw_transcript=(TranscriptPayload.model_validate(result["raw_transcript"]) if result.get("raw_transcript") else None),
        ),
        transcription_seconds=float(payload["transcription_seconds"]),
    )


def _safe_error_message(error: Exception) -> str:
    message = str(error).strip()
    safe_prefixes = ("磁盘可用空间不足", "解析结果未能", "转写稿未能", "总结未能")
    if message.startswith(safe_prefixes):
        return message
    return "这条内容处理失败，请展开错误后重试；其他任务会继续执行。"
