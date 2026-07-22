import logging
from typing import Any

logger = logging.getLogger(__name__)

_SIMPLIFIED_CONVERTER: Any | bool | None = None


def to_simplified_chinese(text: str) -> str:
    """
    统一把模型和 ASR 产生的中文落库文本转换为简体，避免同一工作台混入繁体。
    """
    global _SIMPLIFIED_CONVERTER
    if not text:
        return text

    if _SIMPLIFIED_CONVERTER is False:
        return text

    try:
        if _SIMPLIFIED_CONVERTER is None:
            from opencc import OpenCC

            _SIMPLIFIED_CONVERTER = OpenCC("t2s")
        return str(_SIMPLIFIED_CONVERTER.convert(text))
    except ImportError:
        _SIMPLIFIED_CONVERTER = False
        logger.warning("opencc dependency missing, skipped simplified conversion")
        return text


def simplify_text_payload(value: Any) -> Any:
    """
    递归转换 API payload 中的字符串值；只处理值，不改字段名。
    """
    if isinstance(value, str):
        return to_simplified_chinese(value)

    if isinstance(value, list):
        return [simplify_text_payload(item) for item in value]

    if isinstance(value, dict):
        return {key: simplify_text_payload(item) for key, item in value.items()}

    return value
