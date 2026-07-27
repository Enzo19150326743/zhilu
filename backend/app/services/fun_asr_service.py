import base64
import http.client
import json
import logging
import os
import shutil
import ssl
import subprocess
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

from app.schemas import (
    TranscribeContextSettings,
    TranscriptPayload,
    TranscriptSegment,
)
from app.services.http_fetch_service import (
    DEFAULT_USER_AGENT,
    validate_public_http_url,
)
from app.services.text_normalization_service import to_simplified_chinese

logger = logging.getLogger(__name__)

DEFAULT_FUN_ASR_MODEL = "fun-asr-flash-2026-06-15"
DEFAULT_FUN_ASR_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
FUN_ASR_ENDPOINT_PATH = "/services/aigc/multimodal-generation/generation"
FUN_ASR_CHUNK_SECONDS = 270.0
FUN_ASR_OVERLAP_SECONDS = 2.0
FUN_ASR_MAX_CONCURRENCY = 3
FUN_ASR_MAX_CONTEXT_CHARS = 400
FUN_ASR_MAX_AUDIO_BYTES = 7_500_000
FUN_ASR_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
FUN_ASR_TIMEOUT_SECONDS = 180
FUN_ASR_MAX_ATTEMPTS = 3
FUN_ASR_RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}


class HttpResponseLike(Protocol):
    status: int
    reason: str

    def read(self, amount: int | None = None) -> bytes:
        """读取 HTTP 响应正文。"""


class HttpConnectionLike(Protocol):
    def request(
        self,
        method: str,
        url: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        """发送 HTTP 请求。"""

    def getresponse(self) -> HttpResponseLike:
        """返回 HTTP 响应。"""

    def close(self) -> None:
        """关闭连接。"""


ConnectionFactory = Callable[..., HttpConnectionLike]


@dataclass(frozen=True)
class FunAsrConfig:
    """Fun-ASR-Flash 云端配置快照。"""

    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True)
class FunAsrContext:
    """可以安全发送给云端识别服务的媒体上下文。"""

    title: str | None = None
    author: str | None = None
    platform: str | None = None
    media_type: str | None = None
    context_settings: TranscribeContextSettings | None = None


@dataclass(frozen=True)
class FunAsrAudioChunk:
    """云端识别使用的本地 Opus 片段。"""

    index: int
    path: Path
    start: float
    duration: float
    overlap_seconds: float


@dataclass(frozen=True)
class FunAsrTranscriptionResult:
    """Fun-ASR-Flash 原始转写及诊断信息。"""

    transcript: TranscriptPayload
    model: str
    provider: str
    chunk_count: int
    timestamp_source: str


class FunAsrError(Exception):
    """云端 ASR 的脱敏业务错误。"""

    def __init__(self, error_code: str, message: str, status_code: int = 502):
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


ChunkRequester = Callable[
    [FunAsrAudioChunk, str, FunAsrConfig],
    list[TranscriptSegment],
]
ChunkPreparer = Callable[[Path, Path], list[FunAsrAudioChunk]]


def is_fun_asr_configured() -> bool:
    """只返回是否已配置密钥，不把密钥内容暴露给前端或日志。"""
    return bool(os.getenv("DASHSCOPE_API_KEY", "").strip())


def get_fun_asr_config() -> FunAsrConfig:
    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        raise FunAsrError(
            "FUN_ASR_NOT_CONFIGURED",
            "云端快速识别尚未配置 DASHSCOPE_API_KEY，请改用本地识别或先完成后端配置。",
            status_code=400,
        )

    return FunAsrConfig(
        api_key=api_key,
        base_url=(
            os.getenv("FUN_ASR_BASE_URL", "").strip()
            or DEFAULT_FUN_ASR_BASE_URL
        ),
        model=(
            os.getenv("FUN_ASR_MODEL", "").strip()
            or DEFAULT_FUN_ASR_MODEL
        ),
    )


def transcribe_audio_with_fun_asr(
    audio_path: Path,
    *,
    glossary_terms: list[str],
    context: FunAsrContext,
    output_dir: Path,
    chunk_preparer: ChunkPreparer | None = None,
    requester: ChunkRequester | None = None,
) -> FunAsrTranscriptionResult:
    """
    将任意已下载媒体规范化为 Opus 分段，并发提交到 Fun-ASR-Flash。

    NOTE: 分段只服务于云端接口的 5 分钟输入限制；返回后仍会重新合并为完整转写稿。
    """
    config = get_fun_asr_config()
    prepare_chunks = chunk_preparer or prepare_fun_asr_audio_chunks
    chunks = prepare_chunks(audio_path, output_dir)
    if not chunks:
        raise FunAsrError(
            "FUN_ASR_AUDIO_EMPTY",
            "云端识别没有得到可提交的音频片段。",
        )

    context_text = build_fun_asr_context_text(context, glossary_terms)
    active_requester = requester or _request_fun_asr_chunk
    chunk_results: dict[int, list[TranscriptSegment]] = {}
    max_workers = min(FUN_ASR_MAX_CONCURRENCY, len(chunks))

    with ThreadPoolExecutor(
        max_workers=max_workers,
        thread_name_prefix="fun-asr",
    ) as executor:
        future_map = {
            executor.submit(active_requester, chunk, context_text, config): chunk
            for chunk in chunks
        }
        try:
            for future in as_completed(future_map):
                chunk = future_map[future]
                try:
                    chunk_segments = future.result()
                    if not chunk_segments:
                        raise FunAsrError(
                            "FUN_ASR_EMPTY_CHUNK",
                            "该片段没有返回可用文本。",
                        )
                    chunk_results[chunk.index] = chunk_segments
                except FunAsrError as error:
                    for pending_future in future_map:
                        pending_future.cancel()
                    raise FunAsrError(
                        error.error_code,
                        (
                            f"云端第 {chunk.index + 1}/{len(chunks)} 段识别失败："
                            f"{error.message} 未自动切换本地识别。"
                        ),
                        status_code=error.status_code,
                    ) from error
        finally:
            for pending_future in future_map:
                pending_future.cancel()

    segments = [
        segment
        for chunk in sorted(chunks, key=lambda item: item.index)
        for segment in chunk_results.get(chunk.index, [])
    ]
    if not segments:
        raise FunAsrError(
            "FUN_ASR_EMPTY_RESULT",
            "云端 ASR 未识别到可用文本，请检查媒体是否包含清晰人声。",
        )

    return FunAsrTranscriptionResult(
        transcript=TranscriptPayload(
            segments=segments,
            plain_text=" ".join(segment.text for segment in segments),
        ),
        model=config.model,
        provider="aliyun",
        chunk_count=len(chunks),
        timestamp_source="fun-asr-word",
    )


def build_fun_asr_context_text(
    context: FunAsrContext,
    glossary_terms: list[str],
) -> str:
    """在官方 400 字符限制内组织动态术语和节目上下文。"""
    context_parts: list[str] = []
    if context.title:
        context_parts.append(f"标题：{context.title}")
    if context.author:
        context_parts.append(f"作者：{context.author}")
    if context.platform:
        context_parts.append(f"平台：{context.platform}")
    if context.media_type:
        context_parts.append(f"类型：{context.media_type}")

    settings = context.context_settings
    if settings:
        context_parts.append(f"节目结构：{settings.program_structure}")
        if settings.content_tags:
            context_parts.append("标签：" + "、".join(settings.content_tags))
        speaker_terms = [
            " / ".join(
                value.strip()
                for value in (speaker.name or "", speaker.role or "")
                if value.strip()
            )
            for speaker in settings.speakers
        ]
        speaker_terms = [term for term in speaker_terms if term]
        if speaker_terms:
            context_parts.append("说话人：" + "、".join(speaker_terms))

    if glossary_terms:
        context_parts.append("术语：" + "、".join(glossary_terms[:120]))

    return "；".join(context_parts)[:FUN_ASR_MAX_CONTEXT_CHARS]


def prepare_fun_asr_audio_chunks(
    audio_path: Path,
    output_dir: Path,
) -> list[FunAsrAudioChunk]:
    """先统一转为低码率 Opus，再按固定重叠窗口生成云端片段。"""
    ffmpeg_command = _resolve_media_tool("ffmpeg")
    ffprobe_command = _resolve_media_tool("ffprobe")
    if not ffmpeg_command or not ffprobe_command:
        raise FunAsrError(
            "FUN_ASR_FFMPEG_MISSING",
            "云端识别需要 ffmpeg 和 ffprobe 处理媒体格式，请安装后重启后端。",
            status_code=500,
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_path = output_dir / "fun-asr-normalized.opus"
    _run_media_command(
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
            "16000",
            "-c:a",
            "libopus",
            "-b:a",
            "32k",
            "-vbr",
            "on",
            str(normalized_path),
        ],
        error_code="FUN_ASR_AUDIO_CONVERT_FAILED",
        message="ffmpeg 无法把当前媒体转换为云端识别所需的音频。",
    )

    duration = _probe_duration(ffprobe_command, normalized_path)
    chunks: list[FunAsrAudioChunk] = []
    stride = FUN_ASR_CHUNK_SECONDS - FUN_ASR_OVERLAP_SECONDS
    chunk_start = 0.0
    while chunk_start < duration:
        chunk_duration = min(FUN_ASR_CHUNK_SECONDS, duration - chunk_start)
        chunk_path = output_dir / f"fun-asr-chunk-{len(chunks):04d}.opus"
        _run_media_command(
            [
                ffmpeg_command,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{chunk_start:.3f}",
                "-i",
                str(normalized_path),
                "-t",
                f"{chunk_duration:.3f}",
                "-c:a",
                "copy",
                str(chunk_path),
            ],
            error_code="FUN_ASR_AUDIO_SPLIT_FAILED",
            message="ffmpeg 无法完成云端音频分段。",
        )
        if chunk_path.stat().st_size > FUN_ASR_MAX_AUDIO_BYTES:
            raise FunAsrError(
                "FUN_ASR_CHUNK_TOO_LARGE",
                "云端音频片段超过 Base64 输入大小限制。",
                status_code=500,
            )
        chunks.append(
            FunAsrAudioChunk(
                index=len(chunks),
                path=chunk_path,
                start=chunk_start,
                duration=chunk_duration,
                overlap_seconds=(0.0 if not chunks else FUN_ASR_OVERLAP_SECONDS),
            )
        )
        if chunk_start + chunk_duration >= duration:
            break
        chunk_start += stride

    return chunks


def _request_fun_asr_chunk(
    chunk: FunAsrAudioChunk,
    context_text: str,
    config: FunAsrConfig,
    *,
    connection_factory: ConnectionFactory | None = None,
) -> list[TranscriptSegment]:
    endpoint = f"{config.base_url.rstrip('/')}{FUN_ASR_ENDPOINT_PATH}"
    parsed_url = urlparse(endpoint)
    validate_public_http_url(parsed_url.hostname, parsed_url.scheme)

    audio_bytes = chunk.path.read_bytes()
    if len(audio_bytes) > FUN_ASR_MAX_AUDIO_BYTES:
        raise FunAsrError(
            "FUN_ASR_CHUNK_TOO_LARGE",
            "云端音频片段超过 Base64 输入大小限制。",
            status_code=500,
        )

    messages: list[dict[str, Any]] = []
    if context_text:
        messages.append(
            {
                "role": "user",
                "content": [{"type": "input_text", "text": context_text}],
            }
        )
    messages.append(
        {
            "role": "user",
            "content": [
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": (
                            "data:audio/ogg;base64,"
                            + base64.b64encode(audio_bytes).decode("ascii")
                        )
                    },
                }
            ],
        }
    )
    request_body = json.dumps(
        {
            "model": config.model,
            "input": {"messages": messages},
            "parameters": {"format": "opus", "sample_rate": "16000"},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request_path = parsed_url.path or "/"
    if parsed_url.query:
        request_path = f"{request_path}?{parsed_url.query}"
    headers = {
        "Accept": "text/event-stream",
        "Accept-Encoding": "identity",
        "Authorization": f"Bearer {config.api_key}",
        "Connection": "close",
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        "X-DashScope-SSE": "enable",
    }

    last_error: Exception | None = None
    for attempt in range(1, FUN_ASR_MAX_ATTEMPTS + 1):
        connection = _open_connection(
            parsed_url,
            timeout_seconds=FUN_ASR_TIMEOUT_SECONDS,
            connection_factory=connection_factory,
        )
        try:
            connection.request("POST", request_path, body=request_body, headers=headers)
            response = connection.getresponse()
            response_body = response.read(FUN_ASR_MAX_RESPONSE_BYTES + 1)
            if len(response_body) > FUN_ASR_MAX_RESPONSE_BYTES:
                raise FunAsrError(
                    "FUN_ASR_RESPONSE_TOO_LARGE",
                    "云端识别返回内容超过安全大小限制。",
                )
            if (
                response.status in FUN_ASR_RETRYABLE_STATUS_CODES
                and attempt < FUN_ASR_MAX_ATTEMPTS
            ):
                logger.warning(
                    "Fun-ASR request retry: status=%s attempt=%s/%s",
                    response.status,
                    attempt,
                    FUN_ASR_MAX_ATTEMPTS,
                )
                time.sleep(0.8 * attempt)
                continue
            if response.status >= 400:
                raise FunAsrError(
                    "FUN_ASR_REQUEST_FAILED",
                    f"服务返回 HTTP {response.status}，请稍后重试。",
                )
            return _parse_fun_asr_response(response_body, chunk)
        except FunAsrError:
            raise
        except (
            OSError,
            TimeoutError,
            http.client.HTTPException,
            ssl.SSLError,
        ) as error:
            last_error = error
            if attempt < FUN_ASR_MAX_ATTEMPTS:
                logger.warning(
                    "Fun-ASR request retry: error=%s attempt=%s/%s",
                    error.__class__.__name__,
                    attempt,
                    FUN_ASR_MAX_ATTEMPTS,
                )
                time.sleep(0.8 * attempt)
                continue
        finally:
            connection.close()

    raise FunAsrError(
        "FUN_ASR_REQUEST_FAILED",
        f"云端请求失败（{last_error.__class__.__name__ if last_error else '未知错误'}），请稍后重试。",
    ) from last_error


def _parse_fun_asr_response(
    response_body: bytes,
    chunk: FunAsrAudioChunk,
) -> list[TranscriptSegment]:
    response_text = response_body.decode("utf-8", errors="replace")
    payloads: list[dict[str, Any]] = []
    for line in response_text.splitlines():
        stripped_line = line.strip()
        if not stripped_line.startswith("data:"):
            continue
        raw_payload = stripped_line[5:].strip()
        if not raw_payload or raw_payload == "[DONE]":
            continue
        try:
            parsed_payload = json.loads(raw_payload)
        except json.JSONDecodeError as error:
            raise FunAsrError(
                "FUN_ASR_RESPONSE_INVALID",
                "云端识别返回了无法解析的数据。",
            ) from error
        if isinstance(parsed_payload, dict):
            payloads.append(parsed_payload)

    if not payloads:
        try:
            parsed_payload = json.loads(response_text)
        except json.JSONDecodeError as error:
            raise FunAsrError(
                "FUN_ASR_RESPONSE_INVALID",
                "云端识别返回了无法解析的数据。",
            ) from error
        if isinstance(parsed_payload, dict):
            payloads.append(parsed_payload)

    segments: list[TranscriptSegment] = []
    seen_sentences: set[tuple[int, int, str]] = set()
    overlap_cutoff_ms = int(chunk.overlap_seconds * 1000)
    for payload in payloads:
        output = payload.get("output")
        if not isinstance(output, dict):
            continue
        nested_output = output.get("output")
        if isinstance(nested_output, dict):
            output = nested_output
        sentence = output.get("sentence")
        if not isinstance(sentence, dict) or sentence.get("sentence_end") is False:
            continue

        segment = _build_segment_from_fun_asr_sentence(
            sentence,
            chunk_start=chunk.start,
            overlap_cutoff_ms=overlap_cutoff_ms,
        )
        if segment is None:
            continue
        sentence_key = (
            round(segment.start * 1000),
            round(segment.end * 1000),
            segment.text,
        )
        if sentence_key in seen_sentences:
            continue
        seen_sentences.add(sentence_key)
        segments.append(segment)

    segments.sort(key=lambda item: (item.start, item.end))
    return segments


def _build_segment_from_fun_asr_sentence(
    sentence: dict[str, Any],
    *,
    chunk_start: float,
    overlap_cutoff_ms: int,
) -> TranscriptSegment | None:
    words = sentence.get("words")
    retained_words: list[dict[str, Any]] = []
    if isinstance(words, list):
        for word in words:
            if not isinstance(word, dict):
                continue
            end_time = _safe_milliseconds(word.get("end_time"))
            if end_time <= overlap_cutoff_ms:
                continue
            retained_words.append(word)

    if retained_words:
        text = "".join(
            f"{str(word.get('text') or '')}{str(word.get('punctuation') or '')}"
            for word in retained_words
        )
        begin_time = _safe_milliseconds(retained_words[0].get("begin_time"))
        end_time = _safe_milliseconds(retained_words[-1].get("end_time"))
    else:
        begin_time = _safe_milliseconds(sentence.get("begin_time"))
        end_time = _safe_milliseconds(sentence.get("end_time"))
        if end_time <= overlap_cutoff_ms:
            return None
        text = str(sentence.get("text") or "")

    normalized_text = to_simplified_chinese(" ".join(text.strip().split()))
    if not normalized_text:
        return None

    return TranscriptSegment(
        start=chunk_start + begin_time / 1000,
        end=chunk_start + end_time / 1000,
        text=normalized_text,
    )


def _safe_milliseconds(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


def _open_connection(
    parsed_url: Any,
    *,
    timeout_seconds: float,
    connection_factory: ConnectionFactory | None,
) -> HttpConnectionLike:
    connection_kwargs: dict[str, Any] = {"timeout": timeout_seconds}
    if parsed_url.scheme == "https":
        connection_kwargs["context"] = ssl.create_default_context()
        default_factory: ConnectionFactory = http.client.HTTPSConnection
    else:
        default_factory = http.client.HTTPConnection
    factory = connection_factory or default_factory
    return factory(parsed_url.hostname, parsed_url.port, **connection_kwargs)


def _resolve_media_tool(tool_name: str) -> str | None:
    ffmpeg_location = os.getenv("FFMPEG_LOCATION", "").strip()
    executable_names = (
        f"{tool_name}.exe",
        tool_name,
    )
    if ffmpeg_location:
        configured_path = Path(ffmpeg_location).expanduser()
        if configured_path.is_dir():
            for executable_name in executable_names:
                candidate = configured_path / executable_name
                if candidate.is_file():
                    return str(candidate)
        elif configured_path.is_file():
            if tool_name == "ffmpeg":
                return str(configured_path)
            for executable_name in executable_names:
                candidate = configured_path.parent / executable_name
                if candidate.is_file():
                    return str(candidate)

    return shutil.which(tool_name)


def _probe_duration(ffprobe_command: str, audio_path: Path) -> float:
    completed_process = _run_media_command(
        [
            ffprobe_command,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        error_code="FUN_ASR_AUDIO_PROBE_FAILED",
        message="ffprobe 无法读取媒体时长。",
    )
    try:
        duration = float(completed_process.stdout.strip())
    except ValueError as error:
        raise FunAsrError(
            "FUN_ASR_AUDIO_PROBE_FAILED",
            "ffprobe 返回了无效的媒体时长。",
            status_code=500,
        ) from error
    if duration <= 0:
        raise FunAsrError(
            "FUN_ASR_AUDIO_EMPTY",
            "媒体音频时长为空，无法提交云端识别。",
        )
    return duration


def _run_media_command(
    command: list[str],
    *,
    error_code: str,
    message: str,
) -> subprocess.CompletedProcess[str]:
    try:
        completed_process = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=1800,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise FunAsrError(error_code, message, status_code=500) from error
    if completed_process.returncode != 0:
        logger.warning(
            "Fun-ASR media command failed: tool=%s returncode=%s",
            Path(command[0]).name,
            completed_process.returncode,
        )
        raise FunAsrError(error_code, message, status_code=500)
    return completed_process
