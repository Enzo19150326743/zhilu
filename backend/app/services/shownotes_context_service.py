import json
import logging
import os
from typing import Any

from app.schemas import ShownotesContext, ShownotesSpeaker
from app.services.ai_settings import load_ai_settings
from app.services.deepseek_client import (
    DeepSeekClientError,
    post_deepseek_chat_completion,
)

logger = logging.getLogger(__name__)

DEFAULT_SHOWNOTES_CONTEXT_TIMEOUT_SECONDS = 30
DEFAULT_SHOWNOTES_CONTEXT_MAX_TOKENS = 2048
MAX_SHOWNOTES_INPUT_CHARS = 24000
ALLOWED_PROGRAM_STRUCTURES = {"auto", "solo", "interview", "roundtable"}


def extract_shownotes_context(
    shownotes_plain_text: str | None,
    *,
    title: str | None = None,
    author: str | None = None,
) -> ShownotesContext | None:
    """
    从公开 shownotes 提取一次结构化上下文。

    这是转写链路的可选增强能力：没有 shownotes、没有 Key、请求失败或返回非法
    JSON 时均返回 None，不能阻断本地 ASR 和后续校对。
    """
    shownotes = _normalize_text(shownotes_plain_text)
    if not shownotes:
        return None

    ai_settings = load_ai_settings()
    if not ai_settings.api_key:
        logger.info("shownotes context skipped: AI key is not configured")
        return None

    try:
        response_payload = post_deepseek_chat_completion(
            api_key=ai_settings.api_key,
            base_url=ai_settings.base_url,
            payload=_build_request_payload(
                title=title,
                author=author,
                shownotes=shownotes,
                ai_settings=ai_settings,
            ),
            timeout_seconds=_get_timeout_seconds(),
            max_attempts=1,
        )
        content = _extract_message_content(response_payload)
        raw_context = json.loads(content)
        if not isinstance(raw_context, dict):
            raise ValueError("shownotes context JSON root is not an object")
        return _normalize_context(raw_context)
    except (
        DeepSeekClientError,
        TimeoutError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
    ) as error:
        logger.warning(
            "shownotes context extraction failed: error=%s",
            error.__class__.__name__,
        )
        return None


def build_shownotes_extraction_prompt(
    *,
    title: str | None,
    author: str | None,
    shownotes: str,
) -> str:
    """生成只要求结构化上下文的提取提示词。"""
    return f"""
请从以下公开播客 shownotes 中提取可复用的转写上下文。

任务边界：
- 只提取节目结构、主持人、嘉宾、机构名、产品名、专业术语和内容提纲。
- 不要生成普通文字摘要，不要补写 shownotes 没有明确支持的人物关系。
- 人物 confidence 只能使用 high、medium、low；无法确认姓名时不要制造姓名。
- 必须只返回合法 JSON，不要输出 Markdown、解释或 JSON 之外的文字。

标题：{title or "未提供"}
作者：{author or "未提供"}
原始 shownotes：
{shownotes[:MAX_SHOWNOTES_INPUT_CHARS]}

JSON 结构必须为：
{{
  "program_structure": "solo、interview、roundtable 或 auto",
  "speakers": [
    {{
      "name": "真实姓名",
      "role": "主持人、嘉宾或其他明确身份",
      "description": "shownotes 中明确出现的身份说明",
      "confidence": "high、medium 或 low"
    }}
  ],
  "terms": ["机构名、产品名和专业术语"],
  "content_outline": ["shownotes 中明确的内容主题或章节"]
}}
""".strip()


def _build_request_payload(
    *,
    title: str | None,
    author: str | None,
    shownotes: str,
    ai_settings: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": ai_settings.fast_model or ai_settings.model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是结构化信息提取助手。必须严格返回 JSON，"
                    "不输出普通摘要或额外解释。"
                ),
            },
            {
                "role": "user",
                "content": build_shownotes_extraction_prompt(
                    title=title,
                    author=author,
                    shownotes=shownotes,
                ),
            },
        ],
        "max_tokens": _get_max_tokens(),
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.1,
    }
    if ai_settings.supports_deepseek_thinking:
        payload["thinking"] = {"type": "disabled"}
    return payload


def _extract_message_content(response_payload: dict[str, Any]) -> str:
    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("shownotes context response has no choices")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("shownotes context response choice is invalid")
    message = choice.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        raise ValueError("shownotes context response has no content")
    return message["content"]


def _normalize_context(payload: dict[str, Any]) -> ShownotesContext:
    structure = _normalize_text(payload.get("program_structure")) or "auto"
    if structure not in ALLOWED_PROGRAM_STRUCTURES:
        structure = "auto"

    speakers: list[ShownotesSpeaker] = []
    raw_speakers = payload.get("speakers")
    if isinstance(raw_speakers, list):
        for raw_speaker in raw_speakers[:6]:
            if not isinstance(raw_speaker, dict):
                continue
            name = _normalize_text(raw_speaker.get("name"))
            if not name:
                continue
            role = _normalize_text(raw_speaker.get("role")) or "未区分"
            description = _normalize_text(raw_speaker.get("description"))
            confidence = _normalize_text(raw_speaker.get("confidence")) or "medium"
            if confidence not in {"high", "medium", "low"}:
                confidence = "medium"
            speakers.append(
                ShownotesSpeaker(
                    name=name,
                    role=role,
                    description=description,
                    confidence=confidence,
                )
            )

    return ShownotesContext(
        program_structure=structure,
        speakers=speakers,
        terms=_normalize_list(payload.get("terms"), 120),
        content_outline=_normalize_list(payload.get("content_outline"), 12),
    )


def _normalize_list(value: Any, max_items: int) -> list[str]:
    if not isinstance(value, list):
        return []
    values: list[str] = []
    seen: set[str] = set()
    for raw_value in value[:max_items]:
        text = _normalize_text(raw_value)
        if not text or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        values.append(text)
    return values


def _normalize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.strip().split())
    return normalized or None


def _get_timeout_seconds() -> int:
    return _get_env_int(
        "SHOWNOTES_CONTEXT_TIMEOUT_SECONDS",
        DEFAULT_SHOWNOTES_CONTEXT_TIMEOUT_SECONDS,
        5,
        30,
    )


def _get_max_tokens() -> int:
    return _get_env_int(
        "SHOWNOTES_CONTEXT_MAX_TOKENS",
        DEFAULT_SHOWNOTES_CONTEXT_MAX_TOKENS,
        512,
        8192,
    )


def _get_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(value, maximum))
