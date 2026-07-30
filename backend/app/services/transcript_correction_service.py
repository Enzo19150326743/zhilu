import json
import logging
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.schemas import TranscribeContextSettings, TranscriptPayload, TranscriptSegment
from app.services.ai_settings import load_ai_settings
from app.services.deepseek_client import (
    DeepSeekClientError,
    post_deepseek_chat_completion,
)
from app.services.text_normalization_service import to_simplified_chinese
from app.services.transcribe_context_service import (
    build_correction_context_lines,
    get_allowed_speaker_labels,
)

logger = logging.getLogger(__name__)

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_ASR_CORRECTION_MODEL = "deepseek-v4-flash"
DEFAULT_ASR_CORRECTION_MAX_TOKENS = 8192
DEFAULT_ASR_CORRECTION_CHUNK_CHARS = 3500
DEFAULT_ASR_CORRECTION_TIMEOUT_SECONDS = 120
IndexedSegment = tuple[int, TranscriptSegment]
CorrectionRequester = Callable[
    [list[IndexedSegment], list[str], "TranscriptCorrectionContext"],
    str,
]
CORRECTION_FALLBACK_ERRORS = (
    DeepSeekClientError,
    TimeoutError,
    OSError,
    ValueError,
    KeyError,
    TypeError,
)


@dataclass(frozen=True)
class TranscriptCorrectionContext:
    """转写稿校对可使用的媒体上下文。"""

    title: str | None = None
    author: str | None = None
    platform: str | None = None
    media_type: str | None = None
    context_settings: TranscribeContextSettings | None = None


@dataclass(frozen=True)
class TranscriptCorrectionResult:
    """校对结果；失败时 transcript 保持原始稿。"""

    transcript: TranscriptPayload
    status: str
    model: str | None
    speaker_label_status: str | None = None


@dataclass(frozen=True)
class CorrectedSegment:
    """DeepSeek 返回的单个片段校对结果。"""

    text: str
    speaker: str | None = None


class CorrectionPayloadTruncatedError(ValueError):
    """校对返回内容被截断或不是完整 JSON。"""


def get_transcript_correction_status() -> tuple[bool, str]:
    """返回不包含密钥内容的 DeepSeek 校对能力状态。"""
    if not _is_correction_enabled():
        return False, "AI 校对已在后端配置中关闭，所选术语当前不会应用到终稿。"
    if not load_ai_settings().api_key:
        return False, "后端尚未配置 AI_API_KEY，所选术语当前不会应用到终稿。"
    return True, "所选术语会在语音识别完成后用于 DeepSeek 校对。"


def correct_transcript_payload(
    transcript: TranscriptPayload,
    *,
    glossary_terms: list[str],
    context: TranscriptCorrectionContext | None = None,
    requester: CorrectionRequester | None = None,
) -> TranscriptCorrectionResult:
    """
    使用 DeepSeek 校对 ASR 文本；任何失败都返回原始稿，保证转写主链路不中断。
    """
    if not _is_correction_enabled():
        return TranscriptCorrectionResult(
            transcript=transcript,
            status="skipped",
            model=None,
        )

    if not load_ai_settings().api_key and requester is None:
        return TranscriptCorrectionResult(
            transcript=transcript,
            status="skipped",
            model=None,
        )

    if not transcript.segments:
        return TranscriptCorrectionResult(
            transcript=transcript,
            status="skipped",
            model=_get_correction_model(),
        )

    correction_context = context or TranscriptCorrectionContext()
    active_requester = requester or _request_deepseek_correction
    chunks = _chunk_segments(
        transcript.segments,
        _get_env_int(
            "ASR_CORRECTION_CHUNK_CHARS",
            DEFAULT_ASR_CORRECTION_CHUNK_CHARS,
            min_value=2000,
            max_value=50000,
        ),
    )
    corrected_segments = [segment.model_copy() for segment in transcript.segments]
    corrected_chunk_count = 0

    for indexed_segments in chunks:
        corrected_segment_map = _correct_chunk_with_retry(
            indexed_segments,
            glossary_terms,
            correction_context,
            active_requester,
        )
        if not corrected_segment_map:
            continue

        allowed_speaker_labels = _get_allowed_speaker_labels(correction_context)
        for index, original_segment in indexed_segments:
            if index not in corrected_segment_map:
                continue

            corrected_segment = corrected_segment_map[index]
            corrected_text = _normalize_corrected_text(corrected_segment.text)
            corrected_speaker = _normalize_speaker_label(
                corrected_segment.speaker,
                allowed_speaker_labels,
                correction_context.context_settings,
            )
            corrected_segments[index] = original_segment.model_copy(
                update={"speaker": corrected_speaker, "text": corrected_text}
            )
        corrected_chunk_count += 1

    if corrected_chunk_count == 0:
        return TranscriptCorrectionResult(
            transcript=transcript,
            status="failed",
            model=_get_correction_model(),
        )

    return TranscriptCorrectionResult(
        transcript=TranscriptPayload(
            segments=corrected_segments,
            plain_text=_join_segment_text(corrected_segments),
        ),
        status="corrected",
        model=_get_correction_model(),
    )


def _correct_chunk_with_retry(
    indexed_segments: list[IndexedSegment],
    glossary_terms: list[str],
    context: TranscriptCorrectionContext,
    requester: CorrectionRequester,
) -> dict[int, CorrectedSegment]:
    try:
        content = requester(
            indexed_segments,
            glossary_terms,
            context,
        )
        return _parse_corrected_segment_texts(
            content,
            expected_indexes=[index for index, _ in indexed_segments],
        )
    except CORRECTION_FALLBACK_ERRORS as error:
        logger.warning(
            "asr transcript correction chunk fallback: size=%s error=%s",
            len(indexed_segments),
            error.__class__.__name__,
        )
        if (
            len(indexed_segments) <= 1
            or not _should_retry_as_smaller_chunk(error)
        ):
            return {}

        # NOTE: 模型输出天然随输入片段增长；二分重试能把“输出截断”局部化，
        # 避免一个长稿的单次 JSON 失败导致整条转写稿只能使用原始稿。
        midpoint = len(indexed_segments) // 2
        corrected_left = _correct_chunk_with_retry(
            indexed_segments[:midpoint],
            glossary_terms,
            context,
            requester,
        )
        corrected_right = _correct_chunk_with_retry(
            indexed_segments[midpoint:],
            glossary_terms,
            context,
            requester,
        )
        return {**corrected_left, **corrected_right}


def _request_deepseek_correction(
    indexed_segments: list[IndexedSegment],
    glossary_terms: list[str],
    context: TranscriptCorrectionContext,
) -> str:
    ai_settings = load_ai_settings()
    if not ai_settings.api_key:
        raise ValueError("AI_API_KEY is not configured")

    model = _get_correction_model()
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是严谨的 ASR 转写稿校对助手。"
                    "只修正错别字、同音词、专有名词、英文缩写、标点和明显断句。"
                    "可以根据节目结构、说话人名称和身份返回 speaker，但这只是文本推断辅助。"
                    "不确定是谁说的，speaker 返回 null 或“未区分”，不要强行标注。"
                    "不要总结，不要扩写，不要删减事实，不要改变片段顺序。"
                    "必须保留用户提供的 index 对应关系，不要改时间戳。"
                    "必须返回合法 JSON，不要输出 JSON 之外的解释。"
                ),
            },
            {
                "role": "user",
                "content": _build_correction_prompt(
                    indexed_segments,
                    glossary_terms,
                    context,
                ),
            },
        ],
        "max_tokens": _get_env_int(
            "ASR_CORRECTION_MAX_TOKENS",
            DEFAULT_ASR_CORRECTION_MAX_TOKENS,
            min_value=1024,
            max_value=32768,
        ),
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.1,
    }
    if ai_settings.supports_deepseek_thinking:
        payload["thinking"] = {"type": "disabled"}
    response_payload = post_deepseek_chat_completion(
        api_key=ai_settings.api_key,
        base_url=ai_settings.base_url,
        payload=payload,
        timeout_seconds=_get_env_int(
            "ASR_CORRECTION_TIMEOUT_SECONDS",
            DEFAULT_ASR_CORRECTION_TIMEOUT_SECONDS,
            min_value=30,
            max_value=300,
        ),
    )
    return _extract_deepseek_message_content(response_payload)


def _extract_deepseek_message_content(response_payload: dict[str, Any]) -> str:
    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("DeepSeek response has no choices")

    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("DeepSeek response choice is not object")

    if choice.get("finish_reason") == "length":
        raise CorrectionPayloadTruncatedError(
            "DeepSeek correction response truncated"
        )

    message = choice.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        raise ValueError("DeepSeek response has no content")

    return message["content"]


def _build_correction_prompt(
    indexed_segments: list[IndexedSegment],
    glossary_terms: list[str],
    context: TranscriptCorrectionContext,
) -> str:
    metadata_lines = []
    if context.title:
        metadata_lines.append(f"标题：{context.title}")
    if context.author:
        metadata_lines.append(f"作者：{context.author}")
    if context.platform:
        metadata_lines.append(f"平台：{context.platform}")
    if context.media_type:
        metadata_lines.append(f"媒体类型：{context.media_type}")
    if context.context_settings:
        metadata_lines.extend(build_correction_context_lines(context.context_settings))

    glossary_text = "、".join(glossary_terms[:120]) if glossary_terms else "无"
    segment_payload = [
        {
            "index": index,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
        }
        for index, segment in indexed_segments
    ]
    metadata_text = "\n".join(metadata_lines) if metadata_lines else "无"

    return f"""
请校对下面这些 ASR 片段。

媒体信息：
{metadata_text}

优先识别术语：
{glossary_text}

片段 JSON：
{json.dumps(segment_payload, ensure_ascii=False)}

校对要求：
- 只修改 text，可选返回 speaker。
- 不要改变片段数量、顺序或 index。
- 不要总结、扩写、删减事实。
- 不要把口语内容改写成书面摘要。
- speaker 必须来自说话人辅助信息中的名称 / 身份，或使用“说话人 1 / 说话人 2 / 未区分”。
- 不确定是谁说的，speaker 返回 null 或“未区分”，不要强行分配说话人。
- 返回 JSON 结构必须为：
{{
  "segments": [
    {{"index": 0, "speaker": "主持人", "text": "校对后的片段文本"}}
  ]
}}
""".strip()


def _chunk_segments(
    segments: list[TranscriptSegment],
    chunk_chars: int,
) -> list[list[IndexedSegment]]:
    """
    将全部片段组织为多个校对批次。

    NOTE: chunk_chars 只限制一次 DeepSeek 请求的大致输入量；这里会遍历全文，
    不是只读取前 3500 字符，也不会丢弃最后一个批次。
    """
    chunks: list[list[IndexedSegment]] = []
    current_chunk: list[IndexedSegment] = []
    current_chars = 0

    for index, segment in enumerate(segments):
        segment_chars = len(segment.text)
        if current_chunk and current_chars + segment_chars > chunk_chars:
            chunks.append(current_chunk)
            current_chunk = []
            current_chars = 0

        current_chunk.append((index, segment))
        current_chars += segment_chars

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def _parse_corrected_segment_texts(
    content: str,
    *,
    expected_indexes: list[int],
) -> dict[int, CorrectedSegment]:
    try:
        payload = json.loads(_extract_json_text(content))
    except json.JSONDecodeError as error:
        raise CorrectionPayloadTruncatedError(
            "correction content is incomplete JSON"
        ) from error

    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list):
        raise ValueError("correction payload missing segments")

    corrected_segments: dict[int, CorrectedSegment] = {}
    for item in raw_segments:
        if not isinstance(item, dict):
            raise ValueError("correction segment is not object")

        raw_index = item.get("index")
        if not isinstance(raw_index, int):
            raise ValueError("correction segment index missing")

        raw_text = item.get("text")
        if not isinstance(raw_text, str) or not raw_text.strip():
            raise ValueError("correction segment text missing")

        raw_speaker = item.get("speaker")
        corrected_segments[raw_index] = CorrectedSegment(
            text=raw_text,
            speaker=raw_speaker if isinstance(raw_speaker, str) else None,
        )

    if set(corrected_segments) != set(expected_indexes):
        raise ValueError("correction segment indexes mismatch")

    if len(corrected_segments) != len(expected_indexes):
        raise ValueError("correction segment count mismatch")

    return corrected_segments


def _extract_json_text(content: str) -> str:
    stripped_content = content.strip()
    fenced_match = re.search(
        r"```(?:json)?\s*(\{.*\})\s*```",
        stripped_content,
        flags=re.DOTALL,
    )
    if fenced_match:
        return fenced_match.group(1)

    object_match = re.search(r"\{.*\}", stripped_content, flags=re.DOTALL)
    if object_match:
        return object_match.group(0)

    raise CorrectionPayloadTruncatedError("correction content is not complete JSON")


def _should_retry_as_smaller_chunk(error: Exception) -> bool:
    return isinstance(error, CorrectionPayloadTruncatedError)


def _normalize_corrected_text(text: str) -> str:
    normalized_text = " ".join(text.strip().split())
    return to_simplified_chinese(normalized_text)


def _normalize_speaker_label(
    speaker: str | None,
    allowed_speaker_labels: set[str],
    settings: TranscribeContextSettings | None,
) -> str | None:
    if settings is None or settings.program_structure == "solo":
        return None
    if not isinstance(speaker, str):
        return None

    normalized_speaker = " ".join(speaker.strip().split())
    if not normalized_speaker or normalized_speaker == "未区分":
        return None
    if normalized_speaker in allowed_speaker_labels:
        return normalized_speaker

    return None


def _get_allowed_speaker_labels(
    context: TranscriptCorrectionContext,
) -> set[str]:
    if context.context_settings is None:
        return {"未区分"}

    return get_allowed_speaker_labels(context.context_settings)


def format_segment_for_plain_text(segment: TranscriptSegment) -> str:
    """最终稿纯文本保留可用 speaker 前缀，给总结 / QA / 导图提供语境。"""
    text = segment.text.strip()
    if not text:
        return ""
    if segment.speaker:
        return f"{segment.speaker}：{text}"

    return text


def _join_segment_text(segments: list[TranscriptSegment]) -> str:
    return " ".join(
        formatted_text
        for formatted_text in (
            format_segment_for_plain_text(segment) for segment in segments
        )
        if formatted_text
    )


def _is_correction_enabled() -> bool:
    raw_value = os.getenv("ASR_CORRECTION_ENABLED", "1").strip().lower()
    return raw_value not in {"0", "false", "no", "off"}


def _get_correction_model() -> str:
    return (
        os.getenv("AI_CORRECTION_MODEL", "").strip()
        or os.getenv("ASR_CORRECTION_MODEL", "").strip()
        or load_ai_settings().fast_model
        or DEFAULT_ASR_CORRECTION_MODEL
    )


def _get_env_int(
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
