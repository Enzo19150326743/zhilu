import json
import logging
import os
import re
from collections.abc import Callable
from typing import Any

from app.schemas import QaReference, QaRequest, QaResponse
from app.services.ai_settings import load_ai_settings
from app.services.deepseek_client import (
    DeepSeekClientError,
    DeepSeekOutputTruncatedError,
    post_deepseek_chat_completion,
)

logger = logging.getLogger(__name__)

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_QA_FAST_MODEL = "deepseek-v4-flash"
DEFAULT_QA_THINKING_MODEL = "deepseek-v4-pro"
DEFAULT_DEEPSEEK_MAX_TOKENS = 2048
DEFAULT_DEEPSEEK_THINKING_TYPE = "disabled"
DEFAULT_DEEPSEEK_TIMEOUT_SECONDS = 120
MAX_REFERENCE_COUNT = 5
AiRequester = Callable[[QaRequest], str]

MEDIA_TYPE_LABELS = {
    "podcast": "播客单集",
    "video": "视频",
    "media": "媒体内容",
}
TEXT_SOURCE_LABELS = {
    "content": "内容文本",
    "shownotes": "shownotes / 内容简介",
    "subtitle": "平台字幕",
    "asr_transcript": "AI 转写稿",
    "transcript": "字幕 / 逐字稿",
}


def answer_question(
    qa_request: QaRequest,
    ai_requester: AiRequester | None = None,
) -> QaResponse:
    """
    基于当前内容文本回答用户问题。

    NOTE: V0.3 MVP 先复用前端已持有的内容文本，避免过早引入向量检索或新表结构。
    """
    if not load_ai_settings().api_key:
        return _build_local_answer(qa_request, model="local-fallback")

    requester = ai_requester or _request_deepseek_qa
    try:
        content = requester(qa_request)
        return _build_ai_answer_response(qa_request, content)
    except DeepSeekOutputTruncatedError:
        # NOTE: 不完整的 AI 输出不能降级为一条看似正常的本地回答。
        raise
    except (DeepSeekClientError, TimeoutError, OSError, ValueError, KeyError) as error:
        config = _get_deepseek_config_snapshot(qa_request)
        logger.warning(
            (
                "DeepSeek qa fallback: error=%s detail=%s model=%s "
                "base_url=%s max_tokens=%s thinking_type=%s"
            ),
            error.__class__.__name__,
            _format_deepseek_error(error),
            config["model"],
            config["base_url"],
            config["max_tokens"],
            config["thinking_type"],
        )
        return _build_local_answer(qa_request, model=str(config["model"]))


def _request_deepseek_qa(qa_request: QaRequest) -> str:
    ai_settings = load_ai_settings()
    model = _get_qa_model(qa_request)
    max_tokens = _get_deepseek_max_tokens()
    thinking_type = (
        os.getenv("AI_THINKING_TYPE", "").strip()
        or os.getenv("DEEPSEEK_THINKING_TYPE", "").strip()
        or DEFAULT_DEEPSEEK_THINKING_TYPE
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是一个基于媒体内容文本回答问题的助手。只能依据用户提供的内容文本、"
                    "摘要和结构线索回答；如果上下文无法回答，必须说“根据当前媒体内容无法确定”。"
                    "若文本来源是 shownotes 或简介，必须说明它不等于完整逐字稿。必须返回合法 JSON。"
                ),
            },
            {"role": "user", "content": _build_deepseek_prompt(qa_request)},
        ],
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    if ai_settings.supports_deepseek_thinking:
        payload["thinking"] = {"type": thinking_type}
    if ai_settings.supports_deepseek_thinking and thinking_type == "enabled":
        payload["reasoning_effort"] = (
            os.getenv("AI_REASONING_EFFORT", "").strip()
            or os.getenv("DEEPSEEK_REASONING_EFFORT", "high").strip()
        )
    else:
        payload["temperature"] = 0.2

    response_payload = post_deepseek_chat_completion(
        api_key=ai_settings.api_key,
        base_url=ai_settings.base_url,
        payload=payload,
        timeout_seconds=_get_deepseek_timeout_seconds(),
    )

    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("DeepSeek response has no choices")

    choice = choices[0]
    if not isinstance(choice, dict):
        raise ValueError("DeepSeek response choice is invalid")
    if choice.get("finish_reason") == "length":
        raise DeepSeekOutputTruncatedError(
            "AI 输出达到长度限制，结果未完整生成"
        )

    message = choice.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        raise ValueError("DeepSeek response has no content")

    return message["content"]


def _build_deepseek_prompt(qa_request: QaRequest) -> str:
    title = qa_request.video_title or "未命名媒体内容"
    author = qa_request.video_author or "未知作者"
    source_url = qa_request.source_url or "未提供"
    question = qa_request.question.strip()
    content_text = qa_request.transcript_plain_text.strip()
    summary_context = _build_summary_context(qa_request)

    return f"""
请基于以下媒体内容文本回答用户问题。

标题：{title}
作者：{author}
来源：{source_url}
媒体类型：{_get_media_type_label(qa_request)}
文本来源：{_get_text_source_label(qa_request)}

{_build_text_source_boundary(qa_request)}

{summary_context}

用户问题：
{question}

内容文本：
{content_text}

请只返回 JSON，字段必须为：
{{
  "answer": "基于当前内容文本的回答；无法确定时必须写：根据当前媒体内容无法确定。",
  "references": [
    {{"time": null, "text": "支持回答的原文片段"}}
  ]
}}
""".strip()


def _build_summary_context(qa_request: QaRequest) -> str:
    parts: list[str] = []
    if qa_request.summary_tldr and qa_request.summary_tldr.strip():
        parts.append(f"已有摘要：{qa_request.summary_tldr.strip()}")

    timeline_items = [
        f"- {item.time}: {item.content}"
        for item in qa_request.timeline[:MAX_REFERENCE_COUNT]
        if item.content.strip()
    ]
    if timeline_items:
        parts.append("已有结构线索：\n" + "\n".join(timeline_items))

    return "\n\n".join(parts) if parts else "已有摘要：暂无。"


def _build_ai_answer_response(qa_request: QaRequest, content: str) -> QaResponse:
    payload = json.loads(_extract_json_text(content))
    return QaResponse(
        answer=_safe_text(payload.get("answer"), "根据当前媒体内容无法确定。"),
        references=_safe_references(payload.get("references")),
        is_ai_generated=True,
        model=_get_qa_model(qa_request),
    )


def _build_local_answer(qa_request: QaRequest, model: str) -> QaResponse:
    title = qa_request.video_title or "当前媒体内容"
    snippets = _extract_snippets(qa_request.transcript_plain_text)
    if not snippets:
        return QaResponse(
            answer="根据当前媒体内容无法确定。",
            references=[],
            is_ai_generated=False,
            model=model,
        )

    boundary = (
        " 当前文本来自 shownotes / 内容简介，不代表完整音频逐字稿。"
        if _is_shownotes_source(qa_request)
        else ""
    )
    answer = (
        f"《{title}》当前未配置或未成功调用 DeepSeek QA，以下是基于内容文本的本地参考："
        f"{snippets[0]}{boundary}"
    )
    references = [
        QaReference(time="内容文本", text=snippet)
        for snippet in snippets[:MAX_REFERENCE_COUNT]
    ]
    return QaResponse(
        answer=answer,
        references=references,
        is_ai_generated=False,
        model=model,
    )


def _get_qa_model(qa_request: QaRequest) -> str:
    ai_settings = load_ai_settings()
    mode = (qa_request.mode or "fast").strip().lower()
    if mode == "thinking":
        model = (
            os.getenv("AI_THINKING_MODEL", "").strip()
            or os.getenv("DEEPSEEK_QA_THINKING_MODEL", "").strip()
            or ai_settings.model
        )
    else:
        model = ai_settings.fast_model

    return model.strip() or DEFAULT_QA_FAST_MODEL


def _get_deepseek_max_tokens() -> int:
    raw_max_tokens = os.getenv("AI_QA_MAX_TOKENS", "").strip()
    if not raw_max_tokens:
        raw_max_tokens = os.getenv("DEEPSEEK_QA_MAX_TOKENS", "").strip()
    if not raw_max_tokens:
        raw_max_tokens = (
            os.getenv("AI_MAX_TOKENS", "").strip()
            or os.getenv("DEEPSEEK_MAX_TOKENS", "").strip()
        )
    if not raw_max_tokens:
        return DEFAULT_DEEPSEEK_MAX_TOKENS

    try:
        parsed_max_tokens = int(raw_max_tokens)
    except ValueError:
        return DEFAULT_DEEPSEEK_MAX_TOKENS

    return max(512, min(parsed_max_tokens, 8192))


def _get_deepseek_timeout_seconds() -> int:
    raw_timeout_seconds = os.getenv("AI_QA_TIMEOUT_SECONDS", "").strip()
    if not raw_timeout_seconds:
        raw_timeout_seconds = os.getenv("DEEPSEEK_QA_TIMEOUT_SECONDS", "").strip()
    if not raw_timeout_seconds:
        raw_timeout_seconds = (
            os.getenv("AI_TIMEOUT_SECONDS", "").strip()
            or os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "").strip()
        )
    if not raw_timeout_seconds:
        return DEFAULT_DEEPSEEK_TIMEOUT_SECONDS

    try:
        parsed_timeout_seconds = int(raw_timeout_seconds)
    except ValueError:
        return DEFAULT_DEEPSEEK_TIMEOUT_SECONDS

    return max(60, min(parsed_timeout_seconds, 240))


def _get_deepseek_config_snapshot(qa_request: QaRequest) -> dict[str, str | int]:
    """
    记录非敏感配置，便于用户排查模型名和兼容参数，不输出 API Key。
    """
    ai_settings = load_ai_settings()
    return {
        "base_url": ai_settings.base_url,
        "model": _get_qa_model(qa_request),
        "max_tokens": _get_deepseek_max_tokens(),
        "thinking_type": (
            os.getenv("AI_THINKING_TYPE", "").strip()
            or os.getenv("DEEPSEEK_THINKING_TYPE", "").strip()
            or DEFAULT_DEEPSEEK_THINKING_TYPE
        ),
    }


def _get_media_type_label(qa_request: QaRequest) -> str:
    media_type = (qa_request.media_type or "video").strip().lower()
    return MEDIA_TYPE_LABELS.get(media_type, "媒体内容")


def _get_text_source_label(qa_request: QaRequest) -> str:
    text_source_type = (qa_request.text_source_type or "transcript").strip().lower()
    return TEXT_SOURCE_LABELS.get(text_source_type, "内容文本")


def _is_shownotes_source(qa_request: QaRequest) -> bool:
    return (qa_request.text_source_type or "").strip().lower() == "shownotes"


def _is_asr_transcript_source(qa_request: QaRequest) -> bool:
    return (
        (qa_request.text_source_type or "").strip().lower() == "asr_transcript"
    )


def _build_text_source_boundary(qa_request: QaRequest) -> str:
    if _is_asr_transcript_source(qa_request):
        return (
            "文本边界：当前文本是本地 Whisper 生成的 AI 转写稿，可能存在识别误差。"
            "如果问题依赖精确人名、术语或原句，请基于当前文本谨慎回答。"
        )

    if _is_shownotes_source(qa_request):
        return (
            "文本边界：当前文本是公开 shownotes / 内容简介，不是完整逐字稿。"
            "如果问题依赖完整音频细节，请明确说明“根据当前媒体内容无法确定”。"
        )

    return "文本边界：请只依据当前内容文本回答，不要补充文本中没有的信息。"


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

    raise ValueError("DeepSeek content is not JSON")


def _extract_snippets(content_text: str) -> list[str]:
    normalized_content = re.sub(r"\s+", " ", content_text).strip()
    if not normalized_content:
        return []

    parts = [
        part.strip()
        for part in re.split(r"(?<=[。！？.!?])\s+", normalized_content)
        if part.strip()
    ]
    if len(parts) <= 1:
        parts = [
            normalized_content[index : index + 90].strip()
            for index in range(0, min(len(normalized_content), 360), 90)
        ]

    return parts[:MAX_REFERENCE_COUNT]


def _safe_text(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return fallback


def _safe_references(value: Any) -> list[QaReference]:
    if not isinstance(value, list):
        return []

    references: list[QaReference] = []
    for item in value[:MAX_REFERENCE_COUNT]:
        if not isinstance(item, dict):
            continue

        text = _safe_text(item.get("text"), "")
        if not text:
            continue

        references.append(
            QaReference(
                time=_safe_text(item.get("time"), "内容文本"),
                text=text,
            )
        )

    return references


def _format_deepseek_error(error: Exception) -> str:
    detail = str(error).strip()
    return detail[:500] if detail else "no detail"
