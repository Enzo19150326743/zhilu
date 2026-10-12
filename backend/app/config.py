"""应用启动配置；只加载本项目的环境文件。"""

import os

from dotenv import load_dotenv

from app.paths import BACKEND_DIR

load_dotenv(BACKEND_DIR / ".env")


def read_int_env(name: str, default_value: int) -> int:
    """
    读取整数环境变量，格式错误时使用默认值。
    """
    try:
        return int(os.getenv(name, str(default_value)))
    except ValueError:
        return default_value


APP_VERSION = "0.1.0"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
PARSE_RATE_LIMIT_PER_HOUR = read_int_env("PARSE_RATE_LIMIT_PER_HOUR", 50)
SUMMARY_RATE_LIMIT_PER_HOUR = read_int_env("SUMMARY_RATE_LIMIT_PER_HOUR", 50)
QA_RATE_LIMIT_PER_HOUR = read_int_env("QA_RATE_LIMIT_PER_HOUR", 10)
TRANSCRIBE_RATE_LIMIT_PER_HOUR = read_int_env("TRANSCRIBE_RATE_LIMIT_PER_HOUR", 50)
FRONTEND_ORIGINS = {
    FRONTEND_ORIGIN,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
