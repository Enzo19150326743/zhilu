import os
from dataclasses import dataclass


DEFAULT_AI_PROVIDER = "deepseek"
DEFAULT_AI_BASE_URL = "https://api.deepseek.com"
DEFAULT_AI_MODEL = "deepseek-v4-pro"
DEFAULT_AI_FAST_MODEL = "deepseek-v4-flash"


@dataclass(frozen=True)
class AiSettings:
    """统一保存 OpenAI 兼容接口配置，避免业务层绑定单一厂商变量名。"""

    provider: str
    api_key: str
    base_url: str
    model: str
    fast_model: str

    @property
    def supports_deepseek_thinking(self) -> bool:
        return self.provider == "deepseek"


def load_ai_settings() -> AiSettings:
    """读取通用配置，并兼容旧版本的 DeepSeek 环境变量。"""
    provider = _first_env("AI_PROVIDER") or DEFAULT_AI_PROVIDER
    return AiSettings(
        provider=provider.lower(),
        api_key=_first_env("AI_API_KEY", "DEEPSEEK_API_KEY"),
        base_url=(
            _first_env("AI_BASE_URL", "DEEPSEEK_BASE_URL") or DEFAULT_AI_BASE_URL
        ).rstrip("/"),
        model=_first_env("AI_MODEL", "DEEPSEEK_MODEL") or DEFAULT_AI_MODEL,
        fast_model=(
            _first_env("AI_FAST_MODEL", "DEEPSEEK_QA_FAST_MODEL")
            or DEFAULT_AI_FAST_MODEL
        ),
    )


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value

    return ""
