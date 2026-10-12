"""本项目的固定路径，均相对于源码定位。"""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
DATABASE_PATH = DATA_DIR / "local_library.sqlite3"
