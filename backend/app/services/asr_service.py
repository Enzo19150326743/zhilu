import logging
import os
import tempfile
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from pathlib import Path
from time import monotonic

from fastapi import HTTPException
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, ExtractorError

from app.schemas import (
    ShownotesContext,
    TranscribeContextSettings,
    TranscribeResponse,
    TranscriptAsrMeta,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services.sensevoice_service import (
    SenseVoiceError,
    transcribe_audio_with_sensevoice,
)
from app.services.shownotes_context_service import extract_shownotes_context
from app.services.transcript_segment_service import (
    SegmentNormalizationConfig,
    normalize_adjacent_segments,
)
from app.services.transcript_correction_service import (
    TranscriptCorrectionContext,
    correct_transcript_payload,
    format_segment_for_plain_text,
)
from app.services.transcribe_context_service import (
    get_speaker_label_status,
    merge_shownotes_context,
    normalize_transcribe_context_settings,
)
from app.services.ytdlp_service import (
    _apply_cookie_options,
    _build_extract_options,
    _compact_log_message,
    _is_platform_rejected_error,
)

logger = logging.getLogger(__name__)

DEFAULT_SENSEVOICE_SEGMENT_NORMALIZATION_ENABLED = True
DEFAULT_SENSEVOICE_SEGMENT_MIN_SENTENCE_SECONDS = 4
DEFAULT_SENSEVOICE_SEGMENT_MAX_SECONDS = 8
DEFAULT_SENSEVOICE_SEGMENT_MAX_CHARACTERS = 120
DEFAULT_SENSEVOICE_SEGMENT_SILENCE_GAP_SECONDS = 2
TRANSCRIBE_AUDIO_TEMPLATE = "transcribe-audio.%(ext)s"
TEMP_SUFFIXES = {".part", ".ytdl", ".tmp", ".temp"}
SHOWNOTES_CONTEXT_WAIT_TIMEOUT_SECONDS = 30
AudioDownloader = Callable[[str], Path]
AudioDownloaderFactory = Callable[[Path], AudioDownloader]


@dataclass(frozen=True)
class AsrPromptContext:
    """校对服务使用的媒体上下文。"""

    title: str | None = None
    author: str | None = None
    platform: str | None = None
    media_type: str | None = None
    context_settings: TranscribeContextSettings | None = None


@dataclass(frozen=True)
class AsrTranscriptionResult:
    """ASR 原始转写结果和实际使用的运行配置。"""

    transcript: TranscriptPayload
    model: str
    device: str
    compute_type: str
    language: str | None
    engine: str = "sensevoice-small"
    provider: str | None = "local"
    chunk_count: int | None = None
    timestamp_source: str | None = "vad-segment"
    raw_transcript: TranscriptPayload | None = None


@dataclass(frozen=True)
class PreparedTranscriptionMedia:
    """下载阶段产物；只允许位于调用方提供的任务目录。"""

    path: Path
    audio_download_seconds: float


@dataclass(frozen=True)
class RecognizedTranscription:
    """识别阶段产物；校对可以在释放 GPU 名额后继续。"""

    result: AsrTranscriptionResult
    transcription_seconds: float


def prepare_transcription_media(
    video_url: str,
    output_dir: Path,
    *,
    http_headers: dict[str, str] | None = None,
    audio_downloader: AudioDownloader | None = None,
    audio_downloader_factory: AudioDownloaderFactory | None = None,
) -> PreparedTranscriptionMedia:
    """把转写媒体下载到受控任务目录，成功后返回稳定文件路径。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    active_downloader = audio_downloader or (
        audio_downloader_factory(output_dir)
        if audio_downloader_factory is not None
        else lambda url: _download_audio_for_transcription(url, output_dir, http_headers=http_headers)
    )
    started_at = monotonic()
    audio_path = active_downloader(video_url).resolve()
    root = output_dir.resolve()
    if root not in audio_path.parents or audio_path.suffix.lower() in TEMP_SUFFIXES or not audio_path.is_file():
        raise _build_transcribe_error(
            "ASR_MEDIA_INVALID",
            "转写媒体没有完整保存到任务目录，请稍后重试。",
            status_code=500,
        )
    return PreparedTranscriptionMedia(
        path=audio_path,
        audio_download_seconds=monotonic() - started_at,
    )


def recognize_transcription_media(
    prepared: PreparedTranscriptionMedia,
) -> RecognizedTranscription:
    """使用 SenseVoice 识别本地媒体，校对在后续阶段执行。"""
    started_at = monotonic()
    try:
        sensevoice_result = transcribe_audio_with_sensevoice(
            prepared.path,
            output_dir=prepared.path.parent,
        )
    except SenseVoiceError as error:
        raise _build_transcribe_error(
            error.error_code, error.message, status_code=error.status_code
        ) from error
    raw_transcript = _normalize_transcript_plain_text(sensevoice_result.transcript)
    segments = _normalize_sensevoice_segments(raw_transcript.segments)
    result = AsrTranscriptionResult(
        transcript=TranscriptPayload(segments=segments, plain_text=_join_segment_text(segments)),
        model=sensevoice_result.model,
        device=sensevoice_result.device,
        compute_type=sensevoice_result.compute_type,
        language=sensevoice_result.language,
        timestamp_source=(
            f"{sensevoice_result.timestamp_source}-normalized"
            if len(segments) < len(raw_transcript.segments)
            else sensevoice_result.timestamp_source
        ),
        raw_transcript=raw_transcript.model_copy(deep=True),
    )
    return RecognizedTranscription(result=result, transcription_seconds=monotonic() - started_at)


def finalize_transcription(
    recognized: RecognizedTranscription,
    prepared: PreparedTranscriptionMedia,
    *,
    source_url: str,
    video_id: str | None = None,
    media_title: str | None = None,
    media_author: str | None = None,
    media_platform: str | None = None,
    media_type: str | None = None,
    context_settings: TranscribeContextSettings | None = None,
    shownotes_plain_text: str | None = None,
) -> TranscribeResponse:
    """基于已保存的原始识别结果执行上下文合并和校对。"""
    started_at = monotonic()
    shownotes_context = None
    if _optional_text(shownotes_plain_text):
        shownotes_context = extract_shownotes_context(
            shownotes_plain_text,
            title=media_title,
            author=media_author,
        )
    normalized_settings = normalize_transcribe_context_settings(
        merge_shownotes_context(context_settings, shownotes_context),
        platform=media_platform,
        media_type=media_type,
    )
    transcript = _build_final_transcript(
        transcription_result=recognized.result,
        correction_terms=normalized_settings.correction_terms,
        prompt_context=AsrPromptContext(
            title=_optional_text(media_title),
            author=_optional_text(media_author),
            platform=_optional_text(media_platform),
            media_type=_optional_text(media_type),
            context_settings=normalized_settings,
        ),
    )
    correction_seconds = monotonic() - started_at
    if transcript.asr_meta:
        transcript = transcript.model_copy(
            update={
                "asr_meta": transcript.asr_meta.model_copy(
                    update={
                        "audio_download_seconds": round(prepared.audio_download_seconds, 3),
                        "transcription_seconds": round(recognized.transcription_seconds, 3),
                        "correction_seconds": round(correction_seconds, 3),
                        "total_seconds": round(
                            prepared.audio_download_seconds + recognized.transcription_seconds + correction_seconds,
                            3,
                        ),
                    }
                )
            }
        )
    return TranscribeResponse(
        source_url=source_url,
        video_id=video_id,
        transcript=transcript,
        transcript_variant_key=_transcript_variant_key(recognized.result.engine),
        shownotes_context=shownotes_context,
        message="本地 ASR 已生成 AI 转写稿。",
    )


def transcribe_media_audio(
    video_url: str,
    video_id: str | None = None,
    http_headers: dict[str, str] | None = None,
    audio_downloader: AudioDownloader | None = None,
    audio_downloader_factory: AudioDownloaderFactory | None = None,
    response_source_url: str | None = None,
    media_title: str | None = None,
    media_author: str | None = None,
    media_platform: str | None = None,
    media_type: str | None = None,
    context_settings: TranscribeContextSettings | None = None,
    shownotes_plain_text: str | None = None,
) -> TranscribeResponse:
    """
    下载公开视频音频并使用当前本地模型生成转写稿。

    NOTE: yt-dlp 只负责拿到公开音频资源，不根据平台名称猜测实际媒体格式。
    """
    total_started_at = monotonic()
    shownotes_context_future: Future[ShownotesContext | None] | None = None
    shownotes_executor: ThreadPoolExecutor | None = None
    extracted_shownotes_context: ShownotesContext | None = None
    if _optional_text(shownotes_plain_text):
        shownotes_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="shownotes-context",
        )
        shownotes_context_future = shownotes_executor.submit(
            extract_shownotes_context,
            shownotes_plain_text,
            title=media_title,
            author=media_author,
        )

    with tempfile.TemporaryDirectory(prefix="zhilu-asr-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        active_downloader = audio_downloader or (
            audio_downloader_factory(temporary_path)
            if audio_downloader_factory is not None
            else lambda url: _download_audio_for_transcription(
                url,
                temporary_path,
                http_headers=http_headers,
            )
        )
        download_started_at = monotonic()
        audio_path = active_downloader(video_url)
        audio_download_seconds = monotonic() - download_started_at
        logger.info(
            "asr timing: stage=audio_download elapsed_seconds=%.2f",
            audio_download_seconds,
        )
        try:
            recognized = recognize_transcription_media(
                PreparedTranscriptionMedia(
                    path=audio_path,
                    audio_download_seconds=audio_download_seconds,
                )
            )
            transcription_result = recognized.result
            transcription_seconds = recognized.transcription_seconds
            logger.info(
                (
                    "asr timing: stage=%s elapsed_seconds=%.2f "
                    "engine=%s model=%s device=%s segment_count=%s"
                ),
                transcription_result.engine,
                transcription_seconds,
                transcription_result.engine,
                transcription_result.model,
                transcription_result.device,
                len(transcription_result.transcript.segments),
            )
        finally:
            _remove_file(audio_path)

    extracted_shownotes_context = _resolve_shownotes_context_future(
        shownotes_context_future
    )
    if shownotes_context_future is not None:
        shownotes_context_future.cancel()
    if shownotes_executor is not None:
        shownotes_executor.shutdown(wait=False, cancel_futures=True)

    normalized_context_settings = normalize_transcribe_context_settings(
        merge_shownotes_context(context_settings, extracted_shownotes_context),
        platform=media_platform,
        media_type=media_type,
    )
    correction_terms = normalized_context_settings.correction_terms
    prompt_context = AsrPromptContext(
        title=_optional_text(media_title),
        author=_optional_text(media_author),
        platform=_optional_text(media_platform),
        media_type=_optional_text(media_type),
        context_settings=normalized_context_settings,
    )

    correction_started_at = monotonic()
    transcript = _build_final_transcript(
        transcription_result=transcription_result,
        correction_terms=correction_terms,
        prompt_context=prompt_context,
    )
    correction_status = (
        transcript.asr_meta.correction_status if transcript.asr_meta else "unknown"
    )
    correction_seconds = monotonic() - correction_started_at
    total_seconds = monotonic() - total_started_at
    if transcript.asr_meta:
        transcript = transcript.model_copy(
            update={
                "asr_meta": transcript.asr_meta.model_copy(
                    update={
                        "audio_download_seconds": round(audio_download_seconds, 3),
                        "transcription_seconds": round(transcription_seconds, 3),
                        "correction_seconds": round(correction_seconds, 3),
                        "total_seconds": round(total_seconds, 3),
                    }
                )
            }
        )
    logger.info(
        (
            "asr timing: stage=correction elapsed_seconds=%.2f "
            "status=%s segment_count=%s"
        ),
        correction_seconds,
        correction_status,
        len(transcript.segments),
    )
    logger.info(
        (
            "asr timing: stage=total elapsed_seconds=%.2f "
            "engine=%s model=%s device=%s segment_count=%s"
        ),
        total_seconds,
        transcription_result.engine,
        transcription_result.model,
        transcription_result.device,
        len(transcript.segments),
    )

    return TranscribeResponse(
        source_url=response_source_url or video_url,
        video_id=video_id,
        transcript=transcript,
        transcript_variant_key=_transcript_variant_key(transcription_result.engine),
        shownotes_context=extracted_shownotes_context,
        message=("本地 SenseVoiceSmall 已生成 AI 转写稿。"
                 if transcription_result.engine == "sensevoice-small" else "本地 ASR 已生成 AI 转写稿。"),
    )


def _transcript_variant_key(engine: str) -> str:
    if engine == "sensevoice-small":
        return "sensevoice_small"
    return "archived_asr"


def _download_audio_for_transcription(
    video_url: str,
    output_dir: Path,
    *,
    http_headers: dict[str, str] | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    options: dict[str, Any] = _build_extract_options(video_url)
    options.update(
        {
            "format": "bestaudio/best",
            "fragment_retries": 2,
            "noplaylist": True,
            "no_warnings": True,
            "outtmpl": str(output_dir / TRANSCRIBE_AUDIO_TEMPLATE),
            "quiet": True,
            "retries": 2,
            "skip_download": False,
            "socket_timeout": 30,
            "windowsfilenames": True,
        }
    )
    if http_headers:
        options["http_headers"] = _normalize_http_headers(http_headers)

    _apply_cookie_options(options)

    try:
        with YoutubeDL(options) as youtube_dl:
            youtube_dl.extract_info(video_url, download=True)
    except (DownloadError, ExtractorError, OSError, TimeoutError) as error:
        _raise_audio_download_error(error)

    audio_path = _find_downloaded_audio(output_dir)
    if audio_path is None:
        raise _build_transcribe_error(
            "ASR_AUDIO_NOT_FOUND",
            "音频下载已结束，但未能定位可转写的音频文件。",
            status_code=500,
        )

    return audio_path


def _raise_audio_download_error(
    error: DownloadError | ExtractorError | OSError | TimeoutError,
) -> None:
    error_message = str(error)
    normalized_message = error_message.lower()
    if _is_platform_rejected_error(normalized_message):
        logger.warning(
            "asr audio download rejected by platform: %s",
            _compact_log_message(error_message),
        )
        raise _build_transcribe_error(
            "ASR_AUDIO_PLATFORM_REJECTED",
            "音频下载失败：平台拒绝了本地音频流请求。当前已能读取标题封面，但没有拿到可用于本地转写 的音频文件。",
        ) from error

    logger.warning("asr audio download failed: %s", error.__class__.__name__)
    raise _build_transcribe_error(
        "ASR_AUDIO_DOWNLOAD_FAILED",
        "音频下载失败，当前没有拿到可用于本地转写 的媒体音频。",
    ) from error


def _normalize_http_headers(http_headers: dict[str, str]) -> dict[str, str]:
    """
    只透传受控服务生成的下载请求头，避免把空值交给 yt-dlp。
    """
    return {
        str(key): str(value)
        for key, value in http_headers.items()
        if str(key).strip() and str(value).strip()
    }


def _find_downloaded_audio(output_dir: Path) -> Path | None:
    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix.lower() not in TEMP_SUFFIXES
    ]
    if not candidates:
        return None

    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def _build_final_transcript(
    *,
    transcription_result: AsrTranscriptionResult,
    correction_terms: list[str],
    prompt_context: AsrPromptContext,
) -> TranscriptPayload:
    correction_transcript = _normalize_transcript_plain_text(
        transcription_result.transcript
    )
    raw_transcript = _normalize_transcript_plain_text(
        transcription_result.raw_transcript or correction_transcript
    )
    correction_context = TranscriptCorrectionContext(
        title=prompt_context.title,
        author=prompt_context.author,
        platform=prompt_context.platform,
        media_type=prompt_context.media_type,
        context_settings=prompt_context.context_settings,
    )
    correction_result = correct_transcript_payload(
        correction_transcript,
        glossary_terms=correction_terms,
        context=correction_context,
    )
    final_transcript = _normalize_transcript_plain_text(correction_result.transcript)
    raw_segments = [segment.model_copy() for segment in raw_transcript.segments]

    return final_transcript.model_copy(
        update={
            "raw_segments": raw_segments,
            "raw_plain_text": raw_transcript.plain_text,
            "asr_meta": TranscriptAsrMeta(
                engine=transcription_result.engine,
                model=transcription_result.model,
                device=transcription_result.device,
                compute_type=transcription_result.compute_type,
                language=transcription_result.language,
                correction_status=correction_result.status,
                correction_model=correction_result.model,
                glossary_term_count=0,
                correction_term_count=len(correction_terms),
                correction_terms=correction_terms,
                program_structure=(
                    prompt_context.context_settings.program_structure
                    if prompt_context.context_settings
                    else None
                ),
                content_tags=(
                    prompt_context.context_settings.content_tags
                    if prompt_context.context_settings
                    else []
                ),
                speaker_profiles=(
                    prompt_context.context_settings.speakers
                    if prompt_context.context_settings
                    else []
                ),
                speaker_label_status=_build_speaker_label_status(
                    final_transcript,
                    prompt_context.context_settings,
                    correction_result.status,
                ),
                provider=transcription_result.provider,
                chunk_count=transcription_result.chunk_count,
                timestamp_source=transcription_result.timestamp_source,
            ),
        }
    )


def _normalize_sensevoice_segments(
    segments: list[TranscriptSegment],
) -> list[TranscriptSegment]:
    """合并 SenseVoice 过短句段，原始词时间戳由调用方另行保留。"""
    if not _get_env_flag(
        "SENSEVOICE_SEGMENT_NORMALIZATION_ENABLED",
        DEFAULT_SENSEVOICE_SEGMENT_NORMALIZATION_ENABLED,
    ):
        return [segment.model_copy() for segment in segments]

    max_seconds = float(
        _get_env_int(
            "SENSEVOICE_SEGMENT_MAX_SECONDS",
            DEFAULT_SENSEVOICE_SEGMENT_MAX_SECONDS,
            2,
            30,
        )
    )
    min_sentence_seconds = min(
        max_seconds,
        float(
            _get_env_int(
                "SENSEVOICE_SEGMENT_MIN_SENTENCE_SECONDS",
                DEFAULT_SENSEVOICE_SEGMENT_MIN_SENTENCE_SECONDS,
                1,
                10,
            )
        ),
    )
    config = SegmentNormalizationConfig(
        max_seconds=max_seconds,
        max_characters=_get_env_int(
            "SENSEVOICE_SEGMENT_MAX_CHARACTERS",
            DEFAULT_SENSEVOICE_SEGMENT_MAX_CHARACTERS,
            20,
            500,
        ),
        silence_gap_seconds=float(
            _get_env_int(
                "SENSEVOICE_SEGMENT_SILENCE_GAP_SECONDS",
                DEFAULT_SENSEVOICE_SEGMENT_SILENCE_GAP_SECONDS,
                1,
                10,
            )
        ),
        min_sentence_seconds=min_sentence_seconds,
    )
    return normalize_adjacent_segments(segments, config=config)


def _normalize_transcript_plain_text(transcript: TranscriptPayload) -> TranscriptPayload:
    if not transcript.segments:
        return transcript

    return transcript.model_copy(
        update={"plain_text": _join_segment_text(transcript.segments)}
    )


def _join_segment_text(segments: list[TranscriptSegment]) -> str:
    return " ".join(
        formatted_text
        for formatted_text in (
            format_segment_for_plain_text(segment) for segment in segments
        )
        if formatted_text
    )


def _build_speaker_label_status(
    transcript: TranscriptPayload,
    settings: TranscribeContextSettings | None,
    correction_status: str,
) -> str | None:
    if settings is None:
        return None

    has_labeled_segments = any(
        bool(segment.speaker and segment.speaker.strip())
        for segment in transcript.segments
    )
    has_unlabeled_segments = any(
        not bool(segment.speaker and segment.speaker.strip())
        for segment in transcript.segments
    )
    return get_speaker_label_status(
        settings,
        has_labeled_segments=has_labeled_segments,
        has_unlabeled_segments=has_unlabeled_segments,
        failed=correction_status == "failed" and bool(settings.speakers),
    )


def _resolve_shownotes_context_future(
    future: Future[ShownotesContext | None] | None,
) -> ShownotesContext | None:
    if future is None:
        return None

    try:
        return future.result(timeout=SHOWNOTES_CONTEXT_WAIT_TIMEOUT_SECONDS)
    except FutureTimeoutError:
        logger.warning("shownotes context extraction timed out")
    except Exception as error:
        # 提取是可选增强能力，任何线程异常都必须降级到原有转写流程。
        logger.warning(
            "shownotes context future failed: error=%s",
            error.__class__.__name__,
        )
    return None


def _get_env_int(
    name: str,
    default_value: int,
    min_value: int,
    max_value: int,
) -> int:
    raw_value = os.getenv(name, str(default_value)).strip()
    try:
        parsed_value = int(raw_value)
    except ValueError:
        return default_value

    return max(min_value, min(parsed_value, max_value))


def _get_env_flag(name: str, default_value: bool) -> bool:
    raw_value = os.getenv(name, "").strip().lower()
    if not raw_value:
        return default_value

    return raw_value not in {"0", "false", "no", "off"}


def _optional_text(value: str | None) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return None


def _remove_file(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError:
        logger.debug("asr temporary audio cleanup failed")


def _build_transcribe_error(
    error_code: str,
    message: str,
    status_code: int = 400,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"success": False, "error_code": error_code, "message": message},
    )
