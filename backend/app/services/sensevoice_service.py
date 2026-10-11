import importlib.util
import logging
import os
import shutil
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.schemas import TranscriptPayload, TranscriptSegment
from app.services import cuda_runtime


logger = logging.getLogger(__name__)

DEFAULT_SENSEVOICE_MODEL = "iic/SenseVoiceSmall"
DEFAULT_SENSEVOICE_DEVICE = "auto"
DEFAULT_SENSEVOICE_GPU_BATCH_SIZE_SECONDS = 60
DEFAULT_SENSEVOICE_CPU_BATCH_SIZE_SECONDS = 300
SENSEVOICE_SAMPLE_RATE = 16_000
SENSEVOICE_MAX_SEGMENT_MILLISECONDS = 20_000
SENSEVOICE_SENTENCE_ENDINGS = ("。", "！", "？", "!", "?")


class SenseVoiceError(Exception):
    """本地 SenseVoice 可向 API 层安全暴露的错误。"""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        status_code: int = 500,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class SenseVoiceConfig:
    model: str
    device: str
    gpu_batch_size_seconds: int = DEFAULT_SENSEVOICE_GPU_BATCH_SIZE_SECONDS
    cpu_batch_size_seconds: int = DEFAULT_SENSEVOICE_CPU_BATCH_SIZE_SECONDS


@dataclass(frozen=True)
class SenseVoiceTranscriptionResult:
    transcript: TranscriptPayload
    model: str
    device: str
    compute_type: str = "pytorch"
    language: str | None = "auto"
    timestamp_source: str = "sensevoice-word-timestamp"


ModelFactory = Callable[[SenseVoiceConfig], Any]
ResultPostprocessor = Callable[[str], str]

_MODEL_CACHE: dict[tuple[str, str], Any] = {}
_MODEL_CACHE_LOCK = threading.Lock()


def get_sensevoice_status() -> tuple[bool, str | None]:
    """只检查可选依赖，不触发模型下载或 GPU 初始化。"""
    missing_packages = [
        package_name
        for package_name in ("torch", "torchaudio", "funasr")
        if importlib.util.find_spec(package_name) is None
    ]
    if missing_packages:
        return (
            False,
            "尚未安装本地 SenseVoice 依赖：" + "、".join(missing_packages),
        )
    return True, None


def get_sensevoice_config() -> SenseVoiceConfig:
    return SenseVoiceConfig(
        model=(
            os.getenv("SENSEVOICE_MODEL", "").strip()
            or DEFAULT_SENSEVOICE_MODEL
        ),
        device=(
            os.getenv("SENSEVOICE_DEVICE", "").strip().lower()
            or DEFAULT_SENSEVOICE_DEVICE
        ),
        gpu_batch_size_seconds=_read_bounded_int(
            "SENSEVOICE_GPU_BATCH_SIZE_SECONDS",
            DEFAULT_SENSEVOICE_GPU_BATCH_SIZE_SECONDS,
            min_value=10,
            max_value=300,
        ),
        cpu_batch_size_seconds=_read_bounded_int(
            "SENSEVOICE_CPU_BATCH_SIZE_SECONDS",
            DEFAULT_SENSEVOICE_CPU_BATCH_SIZE_SECONDS,
            min_value=10,
            max_value=600,
        ),
    )


def transcribe_audio_with_sensevoice(
    audio_path: Path,
    *,
    output_dir: Path,
    config: SenseVoiceConfig | None = None,
    model_factory: ModelFactory | None = None,
    postprocessor: ResultPostprocessor | None = None,
) -> SenseVoiceTranscriptionResult:
    """将任意媒体规范化后交给 SenseVoiceSmall，并返回现有逐字稿结构。"""
    available, unavailable_message = get_sensevoice_status()
    if not available and model_factory is None:
        raise SenseVoiceError(
            "SENSEVOICE_DEPENDENCY_MISSING",
            unavailable_message or "本地 SenseVoice 依赖尚未安装。",
        )

    normalized_audio_path = _prepare_sensevoice_audio(audio_path, output_dir)
    active_config = config or get_sensevoice_config()
    factory = model_factory or _load_cached_model
    last_error: Exception | None = None

    for device in _resolve_device_candidates(active_config.device):
        candidate_config = SenseVoiceConfig(
            model=active_config.model,
            device=device,
        )
        try:
            model = factory(candidate_config)
            raw_result = model.generate(
                input=str(normalized_audio_path),
                cache={},
                language="auto",
                use_itn=True,
                batch_size_s=_resolve_batch_size_seconds(
                    device,
                    active_config,
                ),
                merge_vad=True,
                merge_length_s=15,
                output_timestamp=True,
                return_time_stamps=True,
            )
            segments = _parse_sensevoice_segments(
                raw_result,
                postprocessor=postprocessor,
            )
        except (RuntimeError, ValueError, TypeError, OSError) as error:
            last_error = error
            logger.warning(
                "sensevoice runtime failed: device=%s error=%s",
                device,
                error.__class__.__name__,
            )
            _release_failed_device(device)
            continue

        if not segments:
            raise SenseVoiceError(
                "SENSEVOICE_EMPTY_RESULT",
                "SenseVoiceSmall 未识别到可用文本，请换一个音频更清晰的媒体重试。",
            )

        return SenseVoiceTranscriptionResult(
            transcript=TranscriptPayload(
                segments=segments,
                plain_text=" ".join(segment.text for segment in segments),
            ),
            model=candidate_config.model,
            device=device,
        )

    raise SenseVoiceError(
        "SENSEVOICE_MODEL_FAILED",
        "SenseVoiceSmall 在 GPU 和 CPU 上都未能完成识别，原有稿件未被覆盖。",
    ) from last_error


def _load_cached_model(config: SenseVoiceConfig) -> Any:
    cache_key = (config.model, config.device)
    with _MODEL_CACHE_LOCK:
        cached_model = _MODEL_CACHE.get(cache_key)
        if cached_model is not None:
            return cached_model

        try:
            cuda_runtime.activate_cuda_dll_directories()
        except (OSError, RuntimeError) as error:
            logger.warning(
                "sensevoice cuda runtime activation failed: error=%s",
                error.__class__.__name__,
            )

        try:
            from funasr import AutoModel
        except ImportError as error:
            raise SenseVoiceError(
                "SENSEVOICE_DEPENDENCY_MISSING",
                "本地 SenseVoice 依赖尚未安装，请完成可选依赖安装后重启后端。",
            ) from error

        model = AutoModel(
            model=config.model,
            vad_model="fsmn-vad",
            vad_kwargs={"max_single_segment_time": 30_000},
            device=config.device,
            disable_update=True,
        )
        _MODEL_CACHE[cache_key] = model
        return model


def _resolve_device_candidates(configured_device: str) -> list[str]:
    normalized_device = configured_device.strip().lower()
    if normalized_device and normalized_device != "auto":
        return [normalized_device]

    try:
        import torch
    except ImportError:
        return ["cpu"]

    return ["cuda:0", "cpu"] if torch.cuda.is_available() else ["cpu"]


def _resolve_batch_size_seconds(
    device: str,
    config: SenseVoiceConfig,
) -> int:
    # 4GB 级显卡先用保守批量；CPU 不占显存，可以维持 FunASR 长音频默认批量。
    if device.startswith("cuda"):
        return config.gpu_batch_size_seconds
    return config.cpu_batch_size_seconds


def _read_bounded_int(
    name: str,
    default_value: int,
    *,
    min_value: int,
    max_value: int,
) -> int:
    raw_value = os.getenv(name, str(default_value)).strip()
    try:
        parsed_value = int(raw_value)
    except ValueError:
        return default_value
    return max(min_value, min(parsed_value, max_value))


def _prepare_sensevoice_audio(audio_path: Path, output_dir: Path) -> Path:
    ffmpeg_command = _resolve_ffmpeg_command()
    if not ffmpeg_command:
        raise SenseVoiceError(
            "SENSEVOICE_FFMPEG_MISSING",
            "SenseVoiceSmall 需要 ffmpeg 统一处理媒体格式，请安装后重启后端。",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_path = output_dir / "sensevoice-normalized.wav"
    completed_process = subprocess.run(
        [
            ffmpeg_command,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(audio_path),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SENSEVOICE_SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            str(normalized_path),
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=600,
    )
    if completed_process.returncode != 0 or not normalized_path.is_file():
        raise SenseVoiceError(
            "SENSEVOICE_AUDIO_CONVERT_FAILED",
            "ffmpeg 无法把当前媒体转换为 SenseVoiceSmall 所需的音频。",
        )
    return normalized_path


def _resolve_ffmpeg_command() -> str | None:
    configured_location = os.getenv("FFMPEG_LOCATION", "").strip()
    if configured_location:
        configured_path = Path(configured_location)
        if configured_path.is_dir():
            executable_path = configured_path / (
                "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
            )
            if executable_path.is_file():
                return str(executable_path)
        elif configured_path.is_file():
            return str(configured_path)

    return shutil.which("ffmpeg")


def _parse_sensevoice_segments(
    raw_result: Any,
    *,
    postprocessor: ResultPostprocessor | None = None,
) -> list[TranscriptSegment]:
    if not isinstance(raw_result, list) or not raw_result:
        raise ValueError("SenseVoice response is empty")

    first_result = raw_result[0]
    if not isinstance(first_result, dict):
        raise TypeError("SenseVoice response item must be an object")

    active_postprocessor = postprocessor or _get_default_postprocessor()
    sentence_info = first_result.get("sentence_info")
    if not isinstance(sentence_info, list) or not sentence_info:
        return _parse_word_timestamp_segments(
            first_result,
            postprocessor=active_postprocessor,
        )

    segments: list[TranscriptSegment] = []
    for raw_segment in sentence_info:
        if not isinstance(raw_segment, dict):
            continue

        raw_text = raw_segment.get("text") or raw_segment.get("sentence")
        if not isinstance(raw_text, str):
            continue
        normalized_text = " ".join(active_postprocessor(raw_text).split())
        if not normalized_text:
            continue

        start = _milliseconds_to_seconds(raw_segment.get("start"))
        end = _milliseconds_to_seconds(raw_segment.get("end"))
        if end < start:
            end = start
        segments.append(
            TranscriptSegment(
                start=start,
                end=end,
                text=normalized_text,
            )
        )

    segments.sort(key=lambda segment: (segment.start, segment.end))
    return segments


def _parse_word_timestamp_segments(
    raw_result: dict[str, Any],
    *,
    postprocessor: ResultPostprocessor,
) -> list[TranscriptSegment]:
    """用 SenseVoice 原生词时间戳恢复句段，不额外下载标点模型。"""
    words = raw_result.get("words")
    timestamps = raw_result.get("timestamp") or raw_result.get("timestamps")
    if (
        not isinstance(words, list)
        or not isinstance(timestamps, list)
        or not words
        or len(words) != len(timestamps)
    ):
        raise ValueError("SenseVoice response is missing aligned word timestamps")

    segments: list[TranscriptSegment] = []
    current_words: list[str] = []
    current_start: float | None = None
    current_end = 0.0

    def flush_segment() -> None:
        nonlocal current_start, current_end, current_words
        if current_start is None or not current_words:
            return
        raw_text = "".join(current_words).replace("▁", " ")
        normalized_text = " ".join(postprocessor(raw_text).split())
        if normalized_text:
            segments.append(
                TranscriptSegment(
                    start=current_start,
                    end=max(current_start, current_end),
                    text=normalized_text,
                )
            )
        current_words = []
        current_start = None
        current_end = 0.0

    for raw_word, raw_timestamp in zip(words, timestamps, strict=True):
        if not isinstance(raw_word, str) or not raw_word:
            continue
        if not isinstance(raw_timestamp, (list, tuple)) or len(raw_timestamp) < 2:
            continue
        start = _milliseconds_to_seconds(raw_timestamp[0])
        end = _milliseconds_to_seconds(raw_timestamp[1])
        if end < start:
            end = start
        if current_start is None:
            current_start = start
        current_end = end
        current_words.append(raw_word)

        sentence_tail = raw_word.rstrip().rstrip("”’\"'）】》")
        elapsed_milliseconds = (current_end - current_start) * 1000
        if sentence_tail.endswith(SENSEVOICE_SENTENCE_ENDINGS) or (
            elapsed_milliseconds >= SENSEVOICE_MAX_SEGMENT_MILLISECONDS
        ):
            flush_segment()

    flush_segment()
    if not segments:
        raise ValueError("SenseVoice word timestamps did not contain usable text")
    return segments


def _get_default_postprocessor() -> ResultPostprocessor:
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
    except ImportError as error:
        raise SenseVoiceError(
            "SENSEVOICE_DEPENDENCY_MISSING",
            "SenseVoice 文本后处理组件不可用，请重新安装可选依赖。",
        ) from error
    return rich_transcription_postprocess


def _milliseconds_to_seconds(value: Any) -> float:
    try:
        return max(0.0, float(value) / 1000.0)
    except (TypeError, ValueError):
        return 0.0


def _release_failed_device(device: str) -> None:
    with _MODEL_CACHE_LOCK:
        failed_keys = [key for key in _MODEL_CACHE if key[1] == device]
        for key in failed_keys:
            _MODEL_CACHE.pop(key, None)

    if not device.startswith("cuda"):
        return
    try:
        import torch

        torch.cuda.empty_cache()
    except (ImportError, RuntimeError):
        return
