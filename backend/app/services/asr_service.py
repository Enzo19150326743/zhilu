import logging
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Any

from fastapi import HTTPException
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, ExtractorError

from app.schemas import (
    TranscribeContextSettings,
    TranscribeResponse,
    TranscriptAsrMeta,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services import cuda_runtime
from app.services.text_normalization_service import to_simplified_chinese
from app.services.transcript_correction_service import (
    TranscriptCorrectionContext,
    correct_transcript_payload,
    format_segment_for_plain_text,
)
from app.services.transcribe_context_service import (
    build_speaker_hotwords,
    build_whisper_context_lines,
    get_speaker_label_status,
    normalize_transcribe_context_settings,
)
from app.services.ytdlp_service import (
    _apply_cookie_options,
    _build_extract_options,
    _compact_log_message,
    _is_platform_rejected_error,
)

logger = logging.getLogger(__name__)

DEFAULT_ASR_MODEL = "large-v3-turbo"
DEFAULT_ASR_FALLBACK_MODEL = "base"
DEFAULT_ASR_DEVICE = "auto"
DEFAULT_ASR_COMPUTE_TYPE = "int8"
DEFAULT_ASR_LANGUAGE = "zh"
DEFAULT_ASR_BEAM_SIZE = 5
DEFAULT_ASR_AUTO_FALLBACK = True
TRANSCRIBE_AUDIO_TEMPLATE = "transcribe-audio.%(ext)s"
TEMP_SUFFIXES = {".part", ".ytdl", ".tmp", ".temp"}
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ASR_GLOSSARY_PATH = PROJECT_ROOT / "docs" / "asr-glossary.md"
DEFAULT_INITIAL_PROMPT = (
    "以下是一段中文视频或播客内容，可能包含 AI、编程、产品、平台、模型和工具相关术语。"
    "请保持原始表达，不要总结内容，并优先正确识别专有名词、英文缩写、人名、品牌词和工具名。"
)
AudioDownloader = Callable[[str], Path]
AudioTranscriber = Callable[[Path], TranscriptPayload]


@dataclass(frozen=True)
class AsrConfig:
    """当前 ASR 环境配置快照。"""

    model: str
    fallback_model: str
    device: str
    compute_type: str
    language: str | None
    beam_size: int
    auto_fallback: bool


@dataclass(frozen=True)
class AsrPromptContext:
    """Whisper 和纠错服务可使用的媒体上下文。"""

    title: str | None = None
    author: str | None = None
    platform: str | None = None
    media_type: str | None = None
    context_settings: TranscribeContextSettings | None = None


@dataclass(frozen=True)
class WhisperModelCandidate:
    """一次 Whisper 模型加载尝试。"""

    model: str
    device: str
    compute_type: str


@dataclass(frozen=True)
class WhisperTranscriptionResult:
    """Whisper 原始转写结果和实际使用的运行配置。"""

    transcript: TranscriptPayload
    model: str
    device: str
    compute_type: str
    language: str | None


def transcribe_media_audio(
    video_url: str,
    video_id: str | None = None,
    http_headers: dict[str, str] | None = None,
    audio_downloader: AudioDownloader | None = None,
    transcriber: AudioTranscriber | None = None,
    response_source_url: str | None = None,
    media_title: str | None = None,
    media_author: str | None = None,
    media_platform: str | None = None,
    media_type: str | None = None,
    context_settings: TranscribeContextSettings | None = None,
) -> TranscribeResponse:
    """
    下载公开视频音频并使用本地 Whisper 生成内容文本。

    NOTE: yt-dlp 只负责拿到公开音频资源，真正的 AI 转写稿生成由本地 ASR 完成。
    """
    total_started_at = monotonic()
    asr_config = get_asr_config()
    glossary_terms = load_asr_glossary_terms()
    normalized_context_settings = normalize_transcribe_context_settings(
        context_settings,
        platform=media_platform,
        media_type=media_type,
    )
    prompt_context = AsrPromptContext(
        title=_optional_text(media_title),
        author=_optional_text(media_author),
        platform=_optional_text(media_platform),
        media_type=_optional_text(media_type),
        context_settings=normalized_context_settings,
    )

    with tempfile.TemporaryDirectory(prefix="zhilu-asr-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        active_downloader = audio_downloader or (
            lambda url: _download_audio_for_transcription(
                url,
                temporary_path,
                http_headers=http_headers,
            )
        )
        download_started_at = monotonic()
        audio_path = active_downloader(video_url)
        logger.info(
            "asr timing: stage=audio_download elapsed_seconds=%.2f",
            monotonic() - download_started_at,
        )
        try:
            whisper_started_at = monotonic()
            if transcriber is None:
                transcription_result = _transcribe_audio_with_whisper(
                    audio_path,
                    asr_config=asr_config,
                    glossary_terms=glossary_terms,
                    prompt_context=prompt_context,
                )
            else:
                transcription_result = WhisperTranscriptionResult(
                    transcript=transcriber(audio_path),
                    model=asr_config.model,
                    device=asr_config.device,
                    compute_type=asr_config.compute_type,
                    language=asr_config.language,
                )
            logger.info(
                (
                    "asr timing: stage=whisper elapsed_seconds=%.2f "
                    "model=%s device=%s segment_count=%s"
                ),
                monotonic() - whisper_started_at,
                transcription_result.model,
                transcription_result.device,
                len(transcription_result.transcript.segments),
            )
        finally:
            _remove_file(audio_path)

    correction_started_at = monotonic()
    transcript = _build_final_transcript(
        transcription_result=transcription_result,
        glossary_terms=glossary_terms,
        prompt_context=prompt_context,
    )
    correction_status = (
        transcript.asr_meta.correction_status if transcript.asr_meta else "unknown"
    )
    logger.info(
        (
            "asr timing: stage=correction elapsed_seconds=%.2f "
            "status=%s segment_count=%s"
        ),
        monotonic() - correction_started_at,
        correction_status,
        len(transcript.segments),
    )
    logger.info(
        (
            "asr timing: stage=total elapsed_seconds=%.2f "
            "model=%s device=%s segment_count=%s"
        ),
        monotonic() - total_started_at,
        transcription_result.model,
        transcription_result.device,
        len(transcript.segments),
    )

    return TranscribeResponse(
        source_url=response_source_url or video_url,
        video_id=video_id,
        transcript=transcript,
        message="本地 Whisper 已生成 AI 转写稿。",
    )


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
            "音频下载失败：平台拒绝了本地音频流请求。当前已能读取标题封面，但没有拿到可交给 Whisper 的音频文件。",
        ) from error

    logger.warning("asr audio download failed: %s", error.__class__.__name__)
    raise _build_transcribe_error(
        "ASR_AUDIO_DOWNLOAD_FAILED",
        "音频下载失败，当前没有拿到可交给 Whisper 的媒体音频。",
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


def get_asr_config() -> AsrConfig:
    """
    读取 ASR 配置；格式错误时使用保守默认值，避免配置污染变成空 500。
    """
    return AsrConfig(
        model=_get_env_text("ASR_WHISPER_MODEL", DEFAULT_ASR_MODEL),
        fallback_model=_get_env_text(
            "ASR_FALLBACK_WHISPER_MODEL",
            DEFAULT_ASR_FALLBACK_MODEL,
        ),
        device=_get_env_text("ASR_DEVICE", DEFAULT_ASR_DEVICE).lower(),
        compute_type=_get_env_text("ASR_COMPUTE_TYPE", DEFAULT_ASR_COMPUTE_TYPE),
        language=_get_optional_env_text("ASR_LANGUAGE", DEFAULT_ASR_LANGUAGE),
        beam_size=_get_env_int("ASR_BEAM_SIZE", DEFAULT_ASR_BEAM_SIZE, 1, 10),
        auto_fallback=_get_env_flag(
            "ASR_AUTO_FALLBACK",
            DEFAULT_ASR_AUTO_FALLBACK,
        ),
    )


def load_asr_glossary_terms(
    glossary_path: Path = DEFAULT_ASR_GLOSSARY_PATH,
) -> list[str]:
    """
    读取 Markdown bullet 术语；文件缺失或损坏不应阻断转写主链路。
    """
    try:
        lines = glossary_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        logger.info("asr glossary file not found")
        return []
    except OSError as error:
        logger.warning("asr glossary read failed: %s", error.__class__.__name__)
        return []

    terms: list[str] = []
    seen_terms: set[str] = set()
    for line in lines:
        stripped_line = line.strip()
        if not stripped_line.startswith(("-", "*", "+")):
            continue

        term = stripped_line[1:].strip()
        if not term:
            continue

        normalized_key = term.casefold()
        if normalized_key in seen_terms:
            continue

        seen_terms.add(normalized_key)
        terms.append(term)

    return terms


def _transcribe_audio_with_whisper(
    audio_path: Path,
    *,
    asr_config: AsrConfig | None = None,
    glossary_terms: list[str] | None = None,
    prompt_context: AsrPromptContext | None = None,
) -> WhisperTranscriptionResult:
    try:
        cuda_runtime.activate_cuda_dll_directories()
    except (OSError, RuntimeError) as error:
        # CUDA 是可选加速能力，运行库激活失败不能阻断后续 CPU 回退。
        logger.warning(
            "project cuda runtime activation failed: error=%s",
            error.__class__.__name__,
        )

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise _build_transcribe_error(
            "ASR_DEPENDENCY_MISSING",
            "本地 ASR 依赖未安装，请重启启动器让后端安装 faster-whisper。",
            status_code=500,
        ) from error

    config = asr_config or get_asr_config()
    candidates = _build_whisper_model_candidates(config)
    last_error: Exception | None = None
    last_error_code = "ASR_MODEL_FAILED"

    for candidate in candidates:
        try:
            model = WhisperModel(
                candidate.model,
                device=candidate.device,
                compute_type=candidate.compute_type,
            )
            raw_segments, _ = model.transcribe(
                str(audio_path),
                language=config.language,
                beam_size=config.beam_size,
                vad_filter=True,
                **build_whisper_decode_options(),
            )
            segments = _build_transcript_segments(raw_segments)
        except ValueError as error:
            last_error = error
            last_error_code = "ASR_MODEL_UNAVAILABLE"
            logger.warning(
                "asr model configuration invalid: model=%s device=%s",
                candidate.model,
                candidate.device,
            )
            continue
        except RuntimeError as error:
            last_error = error
            last_error_code = "ASR_MODEL_FAILED"
            logger.warning(
                "asr model runtime failed: model=%s device=%s error=%s",
                candidate.model,
                candidate.device,
                error.__class__.__name__,
            )
            continue
        except OSError as error:
            if error.__class__.__name__ == "LocalEntryNotFoundError":
                last_error = error
                last_error_code = "ASR_MODEL_UNAVAILABLE"
                logger.warning(
                    "asr model files unavailable: model=%s device=%s",
                    candidate.model,
                    candidate.device,
                )
                continue

            logger.warning("asr audio read failed: %s", error.__class__.__name__)
            raise _build_transcribe_error(
                "ASR_AUDIO_READ_FAILED",
                "音频文件读取失败，请确认本机音频解码环境可用。",
                status_code=500,
            ) from error

        if not segments:
            raise _build_transcribe_error(
                "ASR_EMPTY_RESULT",
                "本地 ASR 未识别到可用文本，可以换一个音频更清晰的公开视频。",
            )

        return WhisperTranscriptionResult(
            transcript=TranscriptPayload(
                segments=segments,
                plain_text=_join_segment_text(segments),
            ),
            model=candidate.model,
            device=candidate.device,
            compute_type=candidate.compute_type,
            language=config.language,
        )

    if last_error_code == "ASR_MODEL_UNAVAILABLE":
        raise _build_transcribe_error(
            "ASR_MODEL_UNAVAILABLE",
            "本地 Whisper 模型配置不可用，已尝试自动回退但仍未成功。",
            status_code=500,
        ) from last_error

    raise _build_transcribe_error(
        "ASR_MODEL_FAILED",
        "本地 Whisper 模型加载或转写失败，已尝试自动回退但仍未成功。",
        status_code=500,
    ) from last_error


def _build_transcript_segments(raw_segments: Any) -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    for segment in raw_segments:
        normalized_text = _normalize_segment_text(segment.text)
        if not normalized_text:
            continue

        segments.append(
            TranscriptSegment(
                start=float(segment.start),
                end=float(segment.end),
                text=normalized_text,
            )
        )

    return segments


def _build_final_transcript(
    *,
    transcription_result: WhisperTranscriptionResult,
    glossary_terms: list[str],
    prompt_context: AsrPromptContext,
) -> TranscriptPayload:
    raw_transcript = _normalize_transcript_plain_text(transcription_result.transcript)
    correction_context = TranscriptCorrectionContext(
        title=prompt_context.title,
        author=prompt_context.author,
        platform=prompt_context.platform,
        media_type=prompt_context.media_type,
        context_settings=prompt_context.context_settings,
    )
    correction_result = correct_transcript_payload(
        raw_transcript,
        glossary_terms=glossary_terms,
        context=correction_context,
    )
    final_transcript = _normalize_transcript_plain_text(correction_result.transcript)
    raw_segments = [segment.model_copy() for segment in raw_transcript.segments]

    return final_transcript.model_copy(
        update={
            "raw_segments": raw_segments,
            "raw_plain_text": raw_transcript.plain_text,
            "asr_meta": TranscriptAsrMeta(
                model=transcription_result.model,
                device=transcription_result.device,
                compute_type=transcription_result.compute_type,
                language=transcription_result.language,
                correction_status=correction_result.status,
                correction_model=correction_result.model,
                glossary_term_count=len(glossary_terms),
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
            ),
        }
    )


def build_whisper_decode_options() -> dict[str, object]:
    """保持声学解码中性，避免长语义 Prompt 触发重复、漏转和错序。"""
    return {
        "initial_prompt": None,
        "hotwords": None,
        "condition_on_previous_text": True,
    }


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


def _build_whisper_model_candidates(config: AsrConfig) -> list[WhisperModelCandidate]:
    fallback_model = config.fallback_model or DEFAULT_ASR_FALLBACK_MODEL
    candidates: list[WhisperModelCandidate] = []

    if config.device == "auto":
        candidates.append(
            WhisperModelCandidate(
                model=config.model,
                device="cuda",
                compute_type=config.compute_type,
            )
        )
        candidates.append(
            WhisperModelCandidate(
                model=fallback_model if config.auto_fallback else config.model,
                device="cpu",
                compute_type=config.compute_type,
            )
        )
    else:
        candidates.append(
            WhisperModelCandidate(
                model=config.model,
                device=config.device,
                compute_type=config.compute_type,
            )
        )
        if config.auto_fallback:
            candidates.append(
                WhisperModelCandidate(
                    model=fallback_model,
                    device="cpu" if config.device == "cuda" else config.device,
                    compute_type=config.compute_type,
                )
            )

    return _dedupe_model_candidates(candidates)


def _dedupe_model_candidates(
    candidates: list[WhisperModelCandidate],
) -> list[WhisperModelCandidate]:
    unique_candidates: list[WhisperModelCandidate] = []
    seen_keys: set[tuple[str, str, str]] = set()
    for candidate in candidates:
        key = (candidate.model, candidate.device, candidate.compute_type)
        if key in seen_keys:
            continue

        seen_keys.add(key)
        unique_candidates.append(candidate)

    return unique_candidates


def _build_initial_prompt(
    context: AsrPromptContext,
    glossary_terms: list[str],
) -> str:
    prompt_parts = [DEFAULT_INITIAL_PROMPT]
    if context.title:
        prompt_parts.append(f"媒体标题：{context.title}")
    if context.author:
        prompt_parts.append(f"作者或频道：{context.author}")
    if context.platform:
        prompt_parts.append(f"平台：{context.platform}")
    if context.media_type:
        prompt_parts.append(f"媒体类型：{context.media_type}")
    if context.context_settings:
        prompt_parts.extend(build_whisper_context_lines(context.context_settings))
    if glossary_terms:
        prompt_parts.append(
            "请优先正确识别以下术语："
            + "、".join(glossary_terms[:120])
            + "。"
        )

    return "\n".join(prompt_parts)


def _build_hotwords(
    glossary_terms: list[str],
    context_settings: TranscribeContextSettings | None = None,
) -> str | None:
    hotwords: list[str] = []
    seen_words: set[str] = set()
    speaker_hotwords = build_speaker_hotwords(context_settings) if context_settings else []
    for term in [*glossary_terms[:120], *speaker_hotwords]:
        normalized_term = term.strip()
        if not normalized_term or normalized_term.casefold() in seen_words:
            continue

        seen_words.add(normalized_term.casefold())
        hotwords.append(normalized_term)

    if not hotwords:
        return None

    return "、".join(hotwords)


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


def _normalize_segment_text(text: str) -> str:
    normalized_text = " ".join(text.strip().split())
    return to_simplified_chinese(normalized_text)


def _get_env_text(name: str, default_value: str) -> str:
    value = os.getenv(name, default_value).strip()
    return value or default_value


def _get_optional_env_text(name: str, default_value: str | None) -> str | None:
    raw_value = os.getenv(name, default_value or "").strip()
    return raw_value or None


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
