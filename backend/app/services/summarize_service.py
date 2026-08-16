import json
import logging
import json
import os
import re
from collections.abc import Callable
from typing import Any

import json_repair

from app.schemas import (
    MindmapMeta,
    SummaryDetailSection,
    SummaryHighlight,
    SummarizeRequest,
    SummarizeResponse,
    TranscriptSegment,
    VideoSummary,
)
from app.services.ai_settings import load_ai_settings
from app.services.deepseek_client import (
    DeepSeekClientError,
    DeepSeekOutputTruncatedError,
    post_deepseek_chat_completion,
)
from app.services.text_normalization_service import (
    simplify_text_payload,
    to_simplified_chinese,
)

logger = logging.getLogger(__name__)

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro"
DEFAULT_DEEPSEEK_MAX_TOKENS = 8192
DEFAULT_DEEPSEEK_THINKING_TYPE = "disabled"
DEFAULT_DEEPSEEK_TIMEOUT_SECONDS = 180
UNIVERSAL_KNOWLEDGE_DRAFT_VERSION = "1.1"
AiRequester = Callable[[SummarizeRequest], str]

_DEEPSEEK_SYSTEM_PROMPT = (
    "你是一个严谨的媒体内容分析助手，负责把单个媒体来源整理成通用知识草稿。"
    "只根据用户提供的当前媒体元数据和内容文本总结，不要编造文本中没有的信息。"
    "外部作者观点只能表述为当前内容的观点，不得推断任何用户的价值观、风格、目标或认同。"
    "不得输出固定知识库页面、个人双链、个人选题或其他个人化判断。"
    "不要输出时间轴、时间点、开始时间或结束时间；当前转写片段时间不够可靠。"
    "必须返回合法 JSON，不要输出 JSON 之外的解释。"
    "所有字符串内部换行必须写成 \\n，字段之间必须使用英文逗号分隔。"
)


class AiSummaryRepairNeededError(Exception):
    """AI 输出内容无法解析为 JSON，需要携带错误上下文请求模型重新输出。"""

    def __init__(self, *, content: str, detail: str) -> None:
        super().__init__(detail)
        self.content = content
        self.detail = detail

MEDIA_TYPE_LABELS = {
    "podcast": "播客单集",
    "video": "视频",
    "media": "媒体内容",
}
OBSIDIAN_CONTENT_TYPE_LABELS = {
    "podcast": "播客",
    "video": "视频",
}
TEXT_SOURCE_LABELS = {
    "content": "内容文本",
    "shownotes": "shownotes / 内容简介",
    "subtitle": "平台字幕",
    "asr_transcript": "AI 转写稿",
    "transcript": "字幕 / 逐字稿",
}
DEFAULT_MINDMAP_CATEGORY = "general"
DEFAULT_MINDMAP_TEMPLATE_ID = "general_tree"
MINDMAP_TEMPLATE_IDS = {
    "self_growth": "self_growth_tree",
    "business_tech": "business_tech_tree",
    "interview_podcast": "interview_podcast_tree",
    "tutorial_howto": "tutorial_howto_tree",
}
MINDMAP_CATEGORY_LABELS = {
    "general": "通用内容",
    "self_growth": "自我成长",
    "business_tech": "商业科技 / 干货",
    "interview_podcast": "访谈播客",
    "tutorial_howto": "教程方法",
}
SUMMARY_PROFILE_TITLES = {
    "information": "关键信息",
    "viewpoint": "核心观点",
    "method": "关键方法",
    "narrative": "重要经历与启发",
    "generic": "内容要点",
}


def summarize_transcript(
    summarize_request: SummarizeRequest,
    ai_requester: AiRequester | None = None,
) -> SummarizeResponse:
    """
    基于内容文本生成结构化总结。

    NOTE: 未配置 Key 或 AI 失败时返回本地基础摘要，保证用户仍能继续处理内容文本。
    """
    normalized_request = _normalize_summarize_request(summarize_request)
    ai_settings = load_ai_settings()
    if not ai_settings.api_key:
        return _simplify_summary_response(
            _build_local_summary(
                normalized_request,
                model="local-fallback",
                fallback_reason="未配置 AI_API_KEY",
            )
        )

    requester = ai_requester or _request_deepseek_summary
    try:
        content = requester(normalized_request)
        return _simplify_summary_response(
            _build_ai_summary_response(normalized_request, content)
        )
    except AiSummaryRepairNeededError as format_error:
        # NOTE: 模型偶发输出非法 JSON 时先自愈重试一次，避免用户直接看到降级。
        return _repair_malformed_ai_summary(
            normalized_request,
            original_content=format_error.content,
            error_detail=format_error.detail,
        )
    except DeepSeekOutputTruncatedError:
        # NOTE: 不完整的 AI 输出不能伪装成一次成功的本地摘要。
        raise
    except (DeepSeekClientError, TimeoutError, OSError, ValueError, KeyError) as error:
        return _fallback_to_local_summary(normalized_request, error)


def _repair_malformed_ai_summary(
    summarize_request: SummarizeRequest,
    *,
    original_content: str,
    error_detail: str,
) -> SummarizeResponse:
    """
    携带损坏内容与解析错误重新请求模型输出完整 JSON，仍失败才降级基础摘要。

    NOTE: 自愈请求单独计费一次；只有在模型输出格式损坏时才会发生，属罕见路径。
    """
    try:
        repaired_content = _request_deepseek_summary_repair(
            summarize_request,
            original_content=original_content,
            error_detail=error_detail,
        )
        return _simplify_summary_response(
            _build_ai_summary_response(summarize_request, repaired_content)
        )
    except AiSummaryRepairNeededError as repair_error:
        logger.warning(
            "AI summary self-repair failed: detail=%s model=%s",
            repair_error.detail,
            load_ai_settings().model,
        )
        return _fallback_to_local_summary(
            summarize_request,
            fallback_reason=f"JSONDecodeError (self-repair failed): {repair_error.detail}",
        )
    except DeepSeekOutputTruncatedError:
        raise
    except (DeepSeekClientError, TimeoutError, OSError, ValueError, KeyError) as error:
        return _fallback_to_local_summary(
            summarize_request,
            fallback_reason=(
                f"JSONDecodeError (self-repair request failed): "
                f"{error.__class__.__name__}: {_format_deepseek_error(error)}"
            ),
        )


def _fallback_to_local_summary(
    summarize_request: SummarizeRequest,
    error: Exception | None = None,
    *,
    fallback_reason: str | None = None,
) -> SummarizeResponse:
    config = _get_deepseek_config_snapshot()
    if error is not None:
        fallback_reason = (
            f"{error.__class__.__name__}: {_format_deepseek_error(error)}"
        )
    resolved_reason = fallback_reason or "unknown error"
    logger.warning(
        (
            "AI summary fallback: detail=%s model=%s "
            "base_url=%s max_tokens=%s thinking_type=%s"
        ),
        resolved_reason,
        config["model"],
        config["base_url"],
        config["max_tokens"],
        config["thinking_type"],
    )
    return _simplify_summary_response(
        _build_local_summary(
            summarize_request,
            model=load_ai_settings().model,
            fallback_reason=resolved_reason,
        )
    )


def _normalize_summarize_request(
    summarize_request: SummarizeRequest,
) -> SummarizeRequest:
    return summarize_request.model_copy(
        update={
            "transcript_plain_text": to_simplified_chinese(
                summarize_request.transcript_plain_text
            ),
            "transcript_segments": [
                segment.model_copy(
                    update={"text": to_simplified_chinese(segment.text)}
                )
                for segment in summarize_request.transcript_segments
            ],
        }
    )


def _simplify_summary_response(
    summarize_response: SummarizeResponse,
) -> SummarizeResponse:
    return SummarizeResponse.model_validate(
        simplify_text_payload(summarize_response.model_dump(mode="python"))
    )


def _request_deepseek_summary(summarize_request: SummarizeRequest) -> str:
    ai_settings = load_ai_settings()
    max_tokens = _get_deepseek_max_tokens()
    thinking_type = (
        os.getenv("AI_THINKING_TYPE", "").strip()
        or os.getenv("DEEPSEEK_THINKING_TYPE", "").strip()
        or DEFAULT_DEEPSEEK_THINKING_TYPE
    )
    payload = {
        "model": ai_settings.model,
        "messages": [
            {
                "role": "system",
                "content": _DEEPSEEK_SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": _build_deepseek_prompt(summarize_request),
            },
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

    return _post_deepseek_payload(ai_settings, payload)


def _request_deepseek_summary_repair(
    summarize_request: SummarizeRequest,
    *,
    original_content: str,
    error_detail: str,
) -> str:
    """
    模型输出 JSON 损坏时，携带错误详情重新请求完整 JSON。

    NOTE: 自愈请求的 max_tokens 至少取 8192，避免修复请求自身再次被截断。
    """
    ai_settings = load_ai_settings()
    max_tokens = max(_get_deepseek_max_tokens(), 8192)
    thinking_type = (
        os.getenv("AI_THINKING_TYPE", "").strip()
        or os.getenv("DEEPSEEK_THINKING_TYPE", "").strip()
        or DEFAULT_DEEPSEEK_THINKING_TYPE
    )
    repair_instruction = (
        "你上一次输出的 JSON 无法解析，解析错误如下：\n"
        f"{error_detail}\n\n"
        "你上一次输出的内容开头为（完整内容参见前一条消息）：\n"
        f"{original_content[:1500]}\n\n"
        "请严格按照最初要求的所有字段和类型，重新输出一份完整的合法 JSON。"
        "不要输出 JSON 之外的任何文字。"
        "所有字符串内部的换行必须写成 \\n，"
        "字段之间必须使用英文逗号分隔，不能有尾随逗号。"
    )
    payload = {
        "model": ai_settings.model,
        "messages": [
            {
                "role": "system",
                "content": _DEEPSEEK_SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": _build_deepseek_prompt(summarize_request),
            },
            {
                "role": "user",
                "content": repair_instruction,
            },
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

    return _post_deepseek_payload(ai_settings, payload)


def _post_deepseek_payload(
    ai_settings: Any,
    payload: dict[str, Any],
) -> str:
    """发送请求并提取模型输出文本；传输与截断错误与主请求路径一致。"""
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


def _get_deepseek_max_tokens() -> int:
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

    return max(1024, min(parsed_max_tokens, 32768))


def _get_deepseek_timeout_seconds() -> int:
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

    return max(60, min(parsed_timeout_seconds, 300))


def _get_deepseek_config_snapshot() -> dict[str, str | int]:
    """
    记录非敏感配置，便于用户排查模型名和兼容参数，不输出 API Key。
    """
    ai_settings = load_ai_settings()
    return {
        "base_url": ai_settings.base_url,
        "model": ai_settings.model,
        "max_tokens": _get_deepseek_max_tokens(),
        "thinking_type": (
            os.getenv("AI_THINKING_TYPE", "").strip()
            or os.getenv("DEEPSEEK_THINKING_TYPE", "").strip()
            or DEFAULT_DEEPSEEK_THINKING_TYPE
        ),
    }


def _format_deepseek_error(error: Exception) -> str:
    detail = str(error).strip()
    return detail[:500] if detail else "no detail"


def _build_deepseek_prompt(summarize_request: SummarizeRequest) -> str:
    title = summarize_request.video_title or "未命名媒体内容"
    author = summarize_request.video_author or "未知作者"
    source_url = summarize_request.source_url or "未提供"
    transcript = summarize_request.transcript_plain_text.strip()
    content_type = _get_obsidian_content_type_label(summarize_request)
    source_boundary = _build_text_source_boundary(summarize_request)
    shownotes_context = (
        json.dumps(
            summarize_request.shownotes_context.model_dump(mode="json"),
            ensure_ascii=False,
        )
        if summarize_request.shownotes_context is not None
        else "无"
    )
    shownotes_plain_text = (
        _trim_text(summarize_request.shownotes_plain_text, 30000)
        if summarize_request.shownotes_plain_text
        else "无"
    )

    return f"""
请基于以下媒体元数据和内容文本，生成单来源通用知识草稿。

标题：{title}
作者：{author}
源链接：{source_url}
内容类型：{content_type}

{source_boundary}

证据区块与优先级：
主要证据：完整校对转写稿。总结、事实判断和原文摘录必须主要依据这里。
{transcript}

辅助人物与术语信息（shownotes_context）：
{shownotes_context}

辅助节目资料（原始 shownotes）：
{shownotes_plain_text}

边界要求：完整转写稿与 shownotes 冲突时，以完整转写稿为准。shownotes 只能用于核对人物身份、专有名词、章节结构和背景，不能把 shownotes 宣传文案写成嘉宾实际发言。quotes 原文摘录只能来自完整转写稿，不能来自 shownotes_context 或原始 shownotes。

通用总结规则：
- 只根据当前媒体元数据和内容文本总结，不引用或推断任何用户的个人背景。
- 必须完整覆盖内容文本的开头、中段和结尾，不能只抓开头，也不要为了简短遗漏后半段的重要转折或结论。
- 先判断 summary_profile：information（时讯、事实、变化）、viewpoint（观点、访谈、商业观察）、method（教程、方法论）、narrative（故事、经历）或 generic（无法可靠判断）。
- key_points 返回 3 到 6 条，必须和 summary_profile 对应：信息类提炼事实、变化和影响；观点类提炼判断、理由和分歧；方法类提炼目标、步骤和条件；叙事类提炼关键经历、转折和启发。不要把外部作者观点等同于任何用户的观点。
- key_points_title 必须使用对应标题：information 为“关键信息”、viewpoint 为“核心观点”、method 为“关键方法”、narrative 为“重要经历与启发”、generic 为“内容要点”。
- content_outline 只在文本存在清晰的阶段、论证或叙事推进时返回 3 到 6 条；否则返回空数组。每一条都必须是一句可独立阅读的完整脉络：写明“这一段谈什么 + 得出什么判断/发生什么变化 + 为什么或凭什么”。不要只返回“提出问题”“分析三大支柱”这类目录标题。原文足够时，每条控制在约 35 到 90 个汉字，保留关键对象、因果关系和数据/案例线索。
- methods 只提取文本中明确出现、可复用的做法，并写清适用条件或限制；没有足够依据时必须返回空数组。不得把常识性劝告、泛泛复习建议或模型自行推导的行动建议写入 methods。
- deep_dive_sections 只返回有文本依据的深入模块，可使用“论证与依据”“案例与背景”“争议与限制”等具体标题；没有足够信息时返回空数组。不得生成名为“结构化分析”的空泛固定栏目。对于超过 2,000 字、且存在明确观点推进、数据、案例或因果论证的文本，必须返回 2 到 3 个模块；每个模块至少写 2 段或 3 条要点，说明“主张是什么、文本给出的依据是什么、两者如何相连”，并点出具体数据、人物、案例或限制（仅限原文确实出现者）。不要用一句“作者通过历史数据支撑观点”代替证据说明。
- 不要强行凑齐原文没有的栏目；证据不足或无法确定的内容写入 content_boundaries，不要编造补全。
- 内容类型当前只允许“视频”和“播客”；不要输出“文章”，除非后续明确上线文章解析功能。
- topics 和 content_keywords 只描述当前内容本身，不包含“视频”“播客”这类媒介形态。
- content_boundaries 记录证据不足、文本来源限制、ASR 误差或需要结合原媒体核实的内容。
- 不输出个人价值判断、个人表达风格、个人目标、个人选题、固定知识库页面或双链。
- 不生成时间轴、时间点、开始时间或结束时间；当前转写片段时间不够可靠。

可靠摘录规则：
- quotes 返回 0 到 6 条来自当前内容文本的可靠原文摘录候选。
- quotes[].text 必须尽量来自内容文本原文，不要把你的概括伪装成引用。
- quotes[].text 不要包含时间点。
- quotes[].reason 只说明这句话的信息价值或表达价值。
- quotes[].use_case 只写通用使用场景，不引用任何用户的个人方向。
- 如果没有足够可信的原文摘录，quotes 返回空数组。

导图规则：
- 请自动判断 content_category，只能从 self_growth、business_tech、interview_podcast、tutorial_howto 中选择一个。
- 导图只能有一个准确的中心主题，并组织 4 到 7 个主要分支。
- 层级控制在 3 到 4 层；每个节点使用短语，不要把整段总结塞进单个节点。
- 分支应反映观点、依据、案例、条件、风险和结论之间的真实关系，不要机械套用固定栏目。
- 视频类内容优先保留主题、步骤和论证关系；播客类内容优先保留人物、观点、故事和争议关系。
- shownotes 只能代表公开内容简介，不要把它当成完整音频逐字稿。
- mindmap_markdown 必须使用 Markdown 标题层级，便于前端渲染为树状图；不要输出普通列表作为主体结构。
- 不虚构内容文本中不存在的主题、时间点或人物关系。

请只返回 JSON，字段必须为：
{{
  "draft_version": "{UNIVERSAL_KNOWLEDGE_DRAFT_VERSION}",
  "content_type": "视频或播客",
  "topics": ["当前内容的通用主题，不包含视频或播客"],
  "summary_profile": "information、viewpoint、method、narrative 或 generic",
  "tldr": "一句话总结",
  "key_points_title": "关键信息、核心观点、关键方法、重要经历与启发或内容要点",
  "key_points": ["覆盖开头、中段和结尾的 3 到 6 条重点内容"],
  "content_outline": ["一条包含主题、判断和因果/证据线索的完整内容脉络；没有清晰推进时为空数组"],
  "method_title": "存在 methods 时固定为可借鉴的方法，否则为 null",
  "methods": ["文本中明确出现的方法、适用条件和限制；没有则为空数组"],
  "deep_dive_sections": [
    {{"title": "论证与依据", "markdown": "用 2 段或 3 条要点展开主张、原文依据及其关系；没有足够信息则整个数组为空"}}
  ],
  "content_keywords": ["只描述当前内容的关键词，不超过 8 个"],
  "quotes": [
    {{
      "text": "来自内容文本的原文摘录",
      "reason": "这段原文的信息价值或表达价值",
      "use_case": "通用使用场景"
    }}
  ],
  "content_boundaries": ["文本来源限制、证据不足或待核实信息"],
  "mindmap_markdown": "# 唯一中心主题\\n## 主要分支\\n### 关系或要点",
  "mindmap_meta": {{
    "layout": "tree",
    "content_category": "business_tech",
    "template_id": "business_tech_tree",
    "content_type": "{content_type}"
  }}
}}
""".strip()


def _get_media_type_label(summarize_request: SummarizeRequest) -> str:
    media_type = (summarize_request.media_type or "video").strip().lower()
    return MEDIA_TYPE_LABELS.get(media_type, "媒体内容")


def _get_obsidian_content_type_label(summarize_request: SummarizeRequest) -> str:
    media_type = (summarize_request.media_type or "video").strip().lower()
    return OBSIDIAN_CONTENT_TYPE_LABELS.get(media_type, "视频")


def _get_text_source_label(summarize_request: SummarizeRequest) -> str:
    text_source_type = (
        summarize_request.text_source_type or "transcript"
    ).strip().lower()
    return TEXT_SOURCE_LABELS.get(text_source_type, "内容文本")


def _is_shownotes_source(summarize_request: SummarizeRequest) -> bool:
    return (summarize_request.text_source_type or "").strip().lower() == "shownotes"


def _is_asr_transcript_source(summarize_request: SummarizeRequest) -> bool:
    return (
        (summarize_request.text_source_type or "").strip().lower()
        == "asr_transcript"
    )


def _build_text_source_boundary(summarize_request: SummarizeRequest) -> str:
    if _is_asr_transcript_source(summarize_request):
        return (
            "文本边界：当前文本是本地 Whisper 生成的 AI 转写稿，可能存在识别误差。"
            "请只依据当前文本总结，对专有名词或不确定表述保持谨慎。"
        )

    if _is_shownotes_source(summarize_request):
        return (
            "文本边界：当前文本是公开 shownotes / 内容简介，不是完整逐字稿。"
            "请基于现有信息总结，并在结论中保留“信息可能不覆盖完整音频内容”的边界。"
        )

    return "文本边界：请只依据当前内容文本总结，不要补充文本中没有的信息。"


def _build_ai_summary_response(
    summarize_request: SummarizeRequest,
    content: str,
) -> SummarizeResponse:
    payload = _parse_summary_payload(content)
    content_keywords = _safe_content_keywords(
        payload.get("content_keywords"),
        payload.get("topics"),
        summarize_request,
    )
    summary_profile = _safe_summary_profile(payload.get("summary_profile"))
    key_points_title = _safe_key_points_title(
        payload.get("key_points_title"),
        summary_profile,
    )
    content_outline = _safe_text_list(payload.get("content_outline"), [])[:6]
    methods = _safe_text_list(payload.get("methods"), [])[:5]
    deep_dive_sections = _safe_deep_dive_sections(
        payload.get("deep_dive_sections")
    )
    # NOTE: 已保存的 1.0 结果只有一段结构化 Markdown；解析时包装成动态区块，
    # 让前端和导出可以用同一套新结构读取历史数据。
    if not deep_dive_sections:
        legacy_analysis = _safe_text(
            payload.get("structured_analysis_markdown"),
            "",
        )
        if legacy_analysis:
            deep_dive_sections = [
                SummaryDetailSection(
                    title="结构化分析",
                    markdown=legacy_analysis,
                )
            ]
    content_boundaries = _safe_content_boundaries(
        payload.get("content_boundaries"),
        summarize_request,
    )
    summary = VideoSummary(
        draft_version=UNIVERSAL_KNOWLEDGE_DRAFT_VERSION,
        content_type=_normalize_content_type(
            payload.get("content_type"),
            summarize_request,
        ),
        topics=_safe_topics(payload.get("topics"), summarize_request),
        tldr=_safe_text(payload.get("tldr"), "AI 已生成总结。"),
        key_points=_safe_text_list(payload.get("key_points"), ["内容文本已完成结构化整理。"]),
        timeline=[],
        structured_analysis_markdown=_build_deep_dive_markdown(deep_dive_sections),
        takeaways=methods,
        highlights=_safe_highlights(
            payload.get("quotes", payload.get("highlights")),
            summarize_request,
        ),
        content_keywords=content_keywords,
        application_clues=methods,
        content_boundaries=content_boundaries,
        summary_profile=summary_profile,
        key_points_title=key_points_title,
        content_outline=content_outline,
        method_title=("可借鉴的方法" if methods else None),
        methods=methods,
        deep_dive_sections=deep_dive_sections,
        search_keywords=content_keywords,
    )
    mindmap_markdown = _safe_text(
        payload.get("mindmap_markdown"),
        _build_local_mindmap(summarize_request),
    )
    mindmap_meta = _build_ai_mindmap_meta(summarize_request, payload)

    return SummarizeResponse(
        summary=summary,
        mindmap_markdown=mindmap_markdown,
        mindmap_meta=mindmap_meta,
        is_ai_generated=True,
        model=load_ai_settings().model,
        fallback_reason=None,
    )


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


def _parse_summary_payload(content: str) -> dict[str, Any]:
    try:
        json_text = _extract_json_text(content)
    except ValueError as extract_error:
        # NOTE: 输出连 JSON 对象结构都没有时同样交给自愈重试路径。
        raise AiSummaryRepairNeededError(
            content=content,
            detail=str(extract_error),
        ) from extract_error

    try:
        return json.loads(json_text)
    except json.JSONDecodeError as original_error:
        repaired_text = _repair_common_json_text(json_text)
        if repaired_text != json_text:
            try:
                payload = json.loads(repaired_text)
                logger.info("repaired malformed summary JSON")
                return payload
            except json.JSONDecodeError:
                pass

        try:
            repaired_payload = json_repair.loads(json_text)
        except Exception:
            repaired_payload = None
        if isinstance(repaired_payload, dict):
            logger.info("repaired malformed summary JSON with json_repair")
            return repaired_payload

        # NOTE: 本地解析全部失败后，交给自愈重试路径，避免用户直接看到降级。
        raise AiSummaryRepairNeededError(
            content=content,
            detail=f"{original_error.__class__.__name__}: {original_error}",
        ) from original_error


def _repair_common_json_text(json_text: str) -> str:
    """
    兼容模型偶发漏逗号或尾随逗号，避免一次轻微格式错误直接降级。
    """
    repaired_text = json_text.strip().lstrip("\ufeff")
    repaired_text = re.sub(r",(\s*[}\]])", r"\1", repaired_text)
    json_keys = (
        "draft_version",
        "tldr",
        "content_type",
        "summary_profile",
        "topics",
        "key_points",
        "key_points_title",
        "content_outline",
        "method_title",
        "methods",
        "deep_dive_sections",
        "markdown",
        "reason_for_saving",
        "personal_relevance",
        "transformation_ideas",
        "topic_candidates",
        "expression_materials",
        "action_suggestions",
        "search_keywords",
        "content_keywords",
        "application_clues",
        "content_boundaries",
        "related_wikilinks",
        "timeline",
        "time",
        "content",
        "structured_analysis_markdown",
        "takeaways",
        "quotes",
        "use_case",
        "to_confirm",
        "highlights",
        "id",
        "text",
        "start",
        "end",
        "reason",
        "tags",
        "source",
        "mindmap_markdown",
        "mindmap_meta",
        "layout",
        "content_category",
        "template_id",
        "media_type",
        "text_source_type",
    )
    key_pattern = "|".join(re.escape(key) for key in json_keys)
    repaired_text = re.sub(
        rf'(?<=[\]\}}"0-9])\s*\n\s*(?="(?:{key_pattern})"\s*:)',
        ",\n",
        repaired_text,
    )
    repaired_text = re.sub(
        rf'(?<=[\]\}}"0-9])\s+(?="(?:{key_pattern})"\s*:)',
        ", ",
        repaired_text,
    )
    return repaired_text


def _build_ai_mindmap_meta(
    summarize_request: SummarizeRequest,
    payload: dict[str, Any],
) -> MindmapMeta:
    raw_meta = payload.get("mindmap_meta")
    meta_payload = raw_meta if isinstance(raw_meta, dict) else {}
    content_category = _normalize_content_category(
        meta_payload.get("content_category")
    )

    return MindmapMeta(
        layout="tree",
        content_category=content_category,
        template_id=_normalize_template_id(
            meta_payload.get("template_id"),
            content_category,
        ),
        media_type=_normalize_meta_text(
            meta_payload.get("media_type"),
            summarize_request.media_type or "media",
        ),
        text_source_type=_normalize_meta_text(
            meta_payload.get("text_source_type"),
            summarize_request.text_source_type or "content",
        ),
    )


def _build_local_mindmap_meta(summarize_request: SummarizeRequest) -> MindmapMeta:
    content_category = _infer_content_category(summarize_request)
    return MindmapMeta(
        layout="tree",
        content_category=content_category,
        template_id=_normalize_template_id(None, content_category),
        media_type=_normalize_meta_text(summarize_request.media_type, "media"),
        text_source_type=_normalize_meta_text(
            summarize_request.text_source_type,
            "content",
        ),
    )


def _normalize_content_category(value: Any) -> str:
    if isinstance(value, str):
        normalized_value = value.strip().lower()
        if normalized_value in MINDMAP_TEMPLATE_IDS:
            return normalized_value

    return DEFAULT_MINDMAP_CATEGORY


def _normalize_template_id(value: Any, content_category: str) -> str:
    expected_template_id = MINDMAP_TEMPLATE_IDS.get(
        content_category,
        DEFAULT_MINDMAP_TEMPLATE_ID,
    )
    if isinstance(value, str) and value.strip() == expected_template_id:
        return value.strip()

    return expected_template_id


def _normalize_meta_text(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip().lower()

    return fallback


def _infer_content_category(summarize_request: SummarizeRequest) -> str:
    title = summarize_request.video_title or ""
    transcript = summarize_request.transcript_plain_text[:2000]
    sample_text = f"{title}\n{transcript}".lower()
    media_type = (summarize_request.media_type or "").strip().lower()

    if _contains_any(sample_text, ["教程", "教学", "如何", "怎么", "步骤", "入门", "实操", "how to"]):
        return "tutorial_howto"

    if _contains_any(sample_text, ["成长", "认知", "习惯", "自律", "情绪", "复盘", "人生", "效率"]):
        return "self_growth"

    if media_type == "podcast" or _contains_any(sample_text, ["访谈", "对话", "嘉宾", "主播", "播客"]):
        return "interview_podcast"

    if _contains_any(sample_text, ["ai", "模型", "商业", "科技", "产品", "创业", "增长", "市场", "投资", "公司"]):
        return "business_tech"

    return DEFAULT_MINDMAP_CATEGORY


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _build_local_summary(
    summarize_request: SummarizeRequest,
    model: str,
    fallback_reason: str | None = None,
) -> SummarizeResponse:
    title = summarize_request.video_title or "当前媒体内容"
    transcript = summarize_request.transcript_plain_text.strip()
    snippets = _extract_snippets(transcript)
    text_label = _get_text_source_label(summarize_request)
    content_keywords = _infer_local_content_keywords(summarize_request)
    summary = VideoSummary(
        draft_version=UNIVERSAL_KNOWLEDGE_DRAFT_VERSION,
        content_type=_get_obsidian_content_type_label(summarize_request),
        topics=content_keywords[:5],
        tldr=f"{title} 已完成{text_label}读取，当前已生成基础摘要。",
        key_points=[
            "当前返回的是基础摘要。",
            f"内容文本长度约 {len(transcript)} 个字符。",
            snippets[0] if snippets else "建议优先确认该媒体内容存在可用文本。",
        ],
        timeline=[],
        structured_analysis_markdown="",
        takeaways=[],
        highlights=_build_local_highlights(summarize_request),
        content_keywords=content_keywords,
        application_clues=[],
        content_boundaries=_build_default_content_boundaries(summarize_request),
        summary_profile="generic",
        key_points_title=SUMMARY_PROFILE_TITLES["generic"],
        content_outline=snippets,
        method_title=None,
        methods=[],
        deep_dive_sections=[],
        search_keywords=content_keywords,
    )
    mindmap_meta = _build_local_mindmap_meta(summarize_request)

    return SummarizeResponse(
        summary=summary,
        mindmap_markdown=_build_local_mindmap(summarize_request, mindmap_meta),
        mindmap_meta=mindmap_meta,
        is_ai_generated=False,
        model=model,
        fallback_reason=fallback_reason,
    )


def _extract_snippets(transcript: str) -> list[str]:
    normalized_transcript = re.sub(r"\s+", " ", transcript).strip()
    if not normalized_transcript:
        return []

    parts = [
        part.strip()
        for part in re.split(r"(?<=[。！？.!?])\s+", normalized_transcript)
        if part.strip()
    ]
    if len(parts) <= 1:
        parts = [
            normalized_transcript[index : index + 72].strip()
            for index in range(0, min(len(normalized_transcript), 216), 72)
        ]

    return parts[:3]


def _infer_local_content_keywords(
    summarize_request: SummarizeRequest,
) -> list[str]:
    """仅从标题和当前文本提取少量通用关键词，不引入个人主题白名单。"""
    title = (summarize_request.video_title or "").strip()
    transcript = summarize_request.transcript_plain_text[:2000]
    sample_text = f"{title}\n{transcript}".lower()
    keyword_rules = (
        (["ai", "人工智能", "模型"], "AI"),
        (["产品", "用户需求", "mvp"], "产品"),
        (["工作流", "流程"], "工作流"),
        (["教程", "教学", "步骤", "how to"], "教程"),
        (["播客", "访谈", "对话"], "访谈"),
        (["创作", "写作", "表达"], "内容创作"),
        (["商业", "市场", "增长"], "商业"),
        (["科技", "技术", "工程"], "技术"),
    )
    keywords = [
        label
        for triggers, label in keyword_rules
        if _contains_any(sample_text, triggers)
    ]
    title_terms = [
        term.strip()
        for term in re.split(r"[\s｜|：:，,、—-]+", title)
        if 2 <= len(term.strip()) <= 40
    ]
    keywords.extend(title_terms[:2])
    return list(dict.fromkeys(keywords))[:8] or ["内容摘要"]


def _get_timed_segments(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    return [
        segment
        for segment in segments
        if (segment.start > 0 or segment.end > 0) and segment.text.strip()
    ]


def _select_evenly_spaced_segments(
    segments: list[TranscriptSegment],
    max_items: int,
) -> list[TranscriptSegment]:
    if len(segments) <= max_items:
        return segments

    last_index = len(segments) - 1
    selected_indexes = {
        round(index * last_index / (max_items - 1)) for index in range(max_items)
    }
    return [segments[index] for index in sorted(selected_indexes)]


def _trim_text(text: str, max_length: int) -> str:
    normalized_text = re.sub(r"\s+", " ", text).strip()
    if len(normalized_text) <= max_length:
        return normalized_text

    return f"{normalized_text[:max_length].rstrip()}..."


def _build_local_mindmap(
    summarize_request: SummarizeRequest,
    mindmap_meta: MindmapMeta | None = None,
) -> str:
    title = summarize_request.video_title or "当前媒体内容"
    meta = mindmap_meta or _build_local_mindmap_meta(summarize_request)
    snippets = _extract_snippets(summarize_request.transcript_plain_text)
    branches = "\n".join(f"### {snippet}" for snippet in snippets) or "### 等待可用内容文本"
    category_label = MINDMAP_CATEGORY_LABELS.get(
        meta.content_category,
        MINDMAP_CATEGORY_LABELS[DEFAULT_MINDMAP_CATEGORY],
    )
    source_boundary = (
        "\n## 文本边界\n### 当前来自 shownotes，不代表完整音频逐字稿"
        if meta.text_source_type == "shownotes"
        else ""
    )

    if meta.content_category == "self_growth":
        return (
            f"# {title}\n"
            f"## 自动分类\n### {category_label}\n"
            f"## 核心困境\n{branches}\n"
            "## 行动练习\n### 稍后重新生成可得到更完整的练习路径\n"
            "## 反思问题\n### 哪个观点最值得立刻应用"
            f"{source_boundary}"
        )

    if meta.content_category == "business_tech":
        return (
            f"# {title}\n"
            f"## 自动分类\n### {category_label}\n"
            f"## 背景与问题\n{branches}\n"
            "## 机制与机会\n### 稍后重新生成可得到更完整的业务结构\n"
            "## 行动建议\n### 结合内容文本复核关键判断"
            f"{source_boundary}"
        )

    if meta.content_category == "interview_podcast":
        return (
            f"# {title}\n"
            f"## 自动分类\n### {category_label}\n"
            "## 人物与主题\n### 结合标题、作者和现有文本识别讨论对象\n"
            f"## 观点与故事\n{branches}\n"
            "## 可追问问题\n### 哪个观点有进一步展开价值"
            f"{source_boundary}"
        )

    if meta.content_category == "tutorial_howto":
        return (
            f"# {title}\n"
            f"## 自动分类\n### {category_label}\n"
            "## 目标\n### 明确这段内容要解决的问题\n"
            f"## 步骤\n{branches}\n"
            "## 注意事项\n### 稍后重新生成可得到更细步骤"
            f"{source_boundary}"
        )

    return (
        f"# {title}\n"
        f"## 自动分类\n### {category_label}\n"
        f"## 内容摘要\n{branches}\n"
        "## 下一步\n### 稍后重新生成 AI 总结"
        f"{source_boundary}"
    )


def _format_markdown_list(items: list[str]) -> str:
    if not items:
        return "- 暂无可用内容线索"

    return "\n".join(f"- {item}" for item in items)


def _safe_text(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return fallback


def _safe_text_list(value: Any, fallback: list[str]) -> list[str]:
    if not isinstance(value, list):
        return fallback

    result = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return result or fallback


def _safe_summary_profile(value: Any) -> str:
    if isinstance(value, str):
        normalized_value = value.strip().lower()
        if normalized_value in SUMMARY_PROFILE_TITLES:
            return normalized_value

    return "generic"


def _safe_key_points_title(value: Any, summary_profile: str) -> str:
    fallback = SUMMARY_PROFILE_TITLES.get(
        summary_profile,
        SUMMARY_PROFILE_TITLES["generic"],
    )
    if isinstance(value, str) and value.strip() == fallback:
        return fallback

    return fallback


def _safe_deep_dive_sections(value: Any) -> list[SummaryDetailSection]:
    if not isinstance(value, list):
        return []

    sections: list[SummaryDetailSection] = []
    seen_titles: set[str] = set()
    for item in value[:3]:
        if not isinstance(item, dict):
            continue
        title = _safe_text(item.get("title"), "")[:80]
        markdown = _safe_text(item.get("markdown"), "")[:12000]
        normalized_title = re.sub(r"\s+", "", title)
        if not title or not markdown or normalized_title in seen_titles:
            continue
        seen_titles.add(normalized_title)
        sections.append(SummaryDetailSection(title=title, markdown=markdown))

    return sections


def _build_deep_dive_markdown(sections: list[SummaryDetailSection]) -> str:
    return "\n\n".join(
        f"## {section.title}\n{section.markdown.strip()}"
        for section in sections
        if section.title.strip() and section.markdown.strip()
    )


def _normalize_content_type(
    value: Any,
    summarize_request: SummarizeRequest,
) -> str:
    if isinstance(value, str):
        normalized_value = value.strip()
        if normalized_value in {"视频", "播客"}:
            return normalized_value

    return _get_obsidian_content_type_label(summarize_request)


def _safe_topics(value: Any, summarize_request: SummarizeRequest) -> list[str]:
    return _safe_content_keywords(value, None, summarize_request)[:5]


def _safe_content_keywords(
    primary_value: Any,
    secondary_value: Any,
    summarize_request: SummarizeRequest,
) -> list[str]:
    keywords: list[str] = []
    for value in (primary_value, secondary_value):
        if not isinstance(value, list):
            continue
        keywords.extend(
            item.strip().strip("[]#")[:40]
            for item in value
            if isinstance(item, str) and item.strip()
        )

    normalized_keywords = [
        keyword
        for keyword in keywords
        if keyword and keyword not in {"视频", "播客", "媒体内容"}
    ]
    return (
        list(dict.fromkeys(normalized_keywords))[:8]
        or _infer_local_content_keywords(summarize_request)
    )


def _safe_content_boundaries(
    value: Any,
    summarize_request: SummarizeRequest,
) -> list[str]:
    boundaries = _safe_text_list(value, [])
    boundaries.extend(_build_default_content_boundaries(summarize_request))
    return list(dict.fromkeys(boundaries))[:6]


def _build_default_content_boundaries(
    summarize_request: SummarizeRequest,
) -> list[str]:
    if _is_asr_transcript_source(summarize_request):
        return [
            "当前内容基于 AI 转写稿，可能存在识别、专有名词或断句误差。",
            "重要原文摘录和事实信息需要结合原媒体复核。",
        ]

    if _is_shownotes_source(summarize_request):
        return [
            "当前文本来自 shownotes / 内容简介，不代表完整音频逐字稿。",
            "总结只能覆盖公开简介中明确出现的信息。",
        ]

    return ["当前草稿只覆盖给定内容文本，不代表来源之外的信息。"]


def _safe_highlights(
    value: Any,
    summarize_request: SummarizeRequest,
) -> list[SummaryHighlight]:
    if not isinstance(value, list):
        return []

    highlights: list[SummaryHighlight] = []
    seen_texts: set[str] = set()
    for index, item in enumerate(value[:8], start=1):
        if not isinstance(item, dict):
            continue

        text = _safe_text(item.get("text"), "")
        if not text or not _is_text_supported_by_transcript(
            text,
            summarize_request.transcript_plain_text,
        ):
            continue

        normalized_text = re.sub(r"\s+", "", text)
        if normalized_text in seen_texts:
            continue
        seen_texts.add(normalized_text)

        reason = _safe_optional_text(item.get("reason"))
        use_case = _safe_optional_text(item.get("use_case"))
        if reason and use_case:
            quote_reason = f"{reason} 可用场景：{use_case}"
        else:
            quote_reason = reason or use_case

        highlights.append(
            SummaryHighlight(
                id=_normalize_highlight_id(item.get("id"), index),
                text=_trim_text(text, 500),
                start=None,
                end=None,
                reason=quote_reason,
                tags=[],
                source="ai",
                source_type=None,
            )
        )

    return highlights[:6]


def _build_local_highlights(
    summarize_request: SummarizeRequest,
) -> list[SummaryHighlight]:
    timed_segments = _select_evenly_spaced_segments(
        _get_timed_segments(summarize_request.transcript_segments),
        3,
    )
    if timed_segments:
        return [
            SummaryHighlight(
                id=f"local-{index:03d}",
                text=_trim_text(segment.text, 500),
                start=None,
                end=None,
                reason="基础摘要从内容文本中提取，建议人工复核后再作为摘录使用。",
                tags=[],
                source="local_fallback",
                source_type=None,
            )
            for index, segment in enumerate(timed_segments, start=1)
            if segment.text.strip()
        ]

    snippets = _extract_snippets(summarize_request.transcript_plain_text)
    return [
        SummaryHighlight(
            id=f"local-{index:03d}",
            text=_trim_text(snippet, 500),
            start=None,
            end=None,
            reason="基础摘要从内容文本中提取，建议人工复核后再作为摘录使用。",
            tags=[],
            source="local_fallback",
            source_type=None,
        )
        for index, snippet in enumerate(snippets[:3], start=1)
        if snippet.strip()
    ]


def _is_text_supported_by_transcript(text: str, transcript: str) -> bool:
    normalized_text = re.sub(r"\s+", "", text)
    normalized_transcript = re.sub(r"\s+", "", transcript)
    if not normalized_text or not normalized_transcript:
        return False

    if normalized_text in normalized_transcript:
        return True

    sample_length = min(len(normalized_text), 24)
    return sample_length >= 12 and normalized_text[:sample_length] in normalized_transcript


def _safe_optional_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return None


def _normalize_highlight_id(value: Any, index: int) -> str:
    if isinstance(value, str) and value.strip():
        normalized_value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip())
        normalized_value = normalized_value.strip("-_")
        if normalized_value:
            return normalized_value[:80]

    return f"ai-{index:03d}"
