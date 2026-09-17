"""单条与批量入口共用的本机稀缺资源名额。"""

import threading

BROWSER_SLOT = threading.BoundedSemaphore(1)
DOWNLOAD_SLOTS = threading.BoundedSemaphore(2)
RECOGNITION_SLOT = threading.BoundedSemaphore(1)
AI_WORK_SLOTS = threading.BoundedSemaphore(2)
DEEPSEEK_HTTP_SLOTS = threading.BoundedSemaphore(2)
