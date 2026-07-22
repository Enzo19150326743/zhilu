import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "demo_seed.json"


@lru_cache(maxsize=1)
def load_demo_seed() -> list[dict[str, Any]]:
    """
    读取本地 Demo 数据。

    NOTE: 推荐内容使用本地 JSON，保证首次打开时不依赖外部平台和 AI API。
    """
    with DATA_PATH.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    demos = payload.get("demos", [])
    if not isinstance(demos, list):
        logger.error("demo_seed.json 中 demos 字段不是列表")
        return []

    return demos


def get_demo_by_id(demo_id: str) -> dict[str, Any] | None:
    """
    根据 Demo ID 获取完整 Demo。
    """
    for demo in load_demo_seed():
        if demo.get("demo_id") == demo_id:
            return demo

    return None
