import http.client
import json
import logging
import ssl
import time
from collections.abc import Callable
from typing import Any, Protocol
from urllib.parse import urlparse

from app.services.http_fetch_service import (
    DEFAULT_USER_AGENT,
    validate_public_http_url,
)

logger = logging.getLogger(__name__)

RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RETRY_DELAY_SECONDS = 0.8
MAX_ERROR_BODY_CHARS = 500
MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024


class HttpResponseLike(Protocol):
    status: int
    reason: str

    def read(self, amount: int | None = None) -> bytes:
        """
        读取响应正文。
        """


class HttpConnectionLike(Protocol):
    def request(
        self,
        method: str,
        url: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        """
        发送 HTTP 请求。
        """

    def getresponse(self) -> HttpResponseLike:
        """
        返回 HTTP 响应。
        """

    def close(self) -> None:
        """
        关闭连接。
        """


ConnectionFactory = Callable[..., HttpConnectionLike]


class DeepSeekClientError(Exception):
    """DeepSeek HTTP 调用失败时返回给上层的脱敏错误。"""


class DeepSeekOutputTruncatedError(DeepSeekClientError):
    """模型因输出长度限制而没有返回完整结果。"""


def post_deepseek_chat_completion(
    *,
    api_key: str,
    base_url: str,
    payload: dict[str, Any],
    timeout_seconds: float,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    retry_delay_seconds: float = DEFAULT_RETRY_DELAY_SECONDS,
    connection_factory: ConnectionFactory | None = None,
) -> dict[str, Any]:
    """
    调用 DeepSeek Chat Completions 接口。
    NOTE: 当前 Windows 本地环境里 urllib/httpx 对部分 HTTPS 站点会触发 TLS EOF，
    但标准库 http.client 配合 Connection: close 已验证可达，因此这里固定走同一连接策略。
    """
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    parsed_url = urlparse(endpoint)
    validate_public_http_url(parsed_url.hostname, parsed_url.scheme)

    attempts = max(1, max_attempts)
    request_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request_path = _build_request_path(parsed_url)
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Authorization": f"Bearer {api_key}",
        "Connection": "close",
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
    }
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        connection = _open_connection(
            parsed_url=parsed_url,
            timeout_seconds=timeout_seconds,
            connection_factory=connection_factory,
        )
        try:
            connection.request(
                "POST",
                request_path,
                body=request_body,
                headers=headers,
            )
            response = connection.getresponse()
            response_body = response.read(MAX_RESPONSE_BODY_BYTES + 1)
            if len(response_body) > MAX_RESPONSE_BODY_BYTES:
                raise DeepSeekClientError("DeepSeek response is too large")

            if _should_retry_status(response.status, attempt, attempts):
                _log_retry("status", attempt, attempts, str(response.status))
                _sleep_before_retry(retry_delay_seconds)
                continue

            if response.status >= 400:
                raise DeepSeekClientError(
                    _format_http_status_error(
                        status=response.status,
                        reason=response.reason,
                        body=response_body,
                    )
                )

            return json.loads(response_body.decode("utf-8", errors="replace"))
        except DeepSeekClientError:
            raise
        except (
            OSError,
            TimeoutError,
            http.client.HTTPException,
            ssl.SSLError,
            json.JSONDecodeError,
        ) as error:
            last_error = error
            if attempt < attempts:
                _log_retry(error.__class__.__name__, attempt, attempts, str(error))
                _sleep_before_retry(retry_delay_seconds)
                continue

            raise DeepSeekClientError(_format_transport_error(error)) from error
        finally:
            connection.close()

    raise DeepSeekClientError(_format_transport_error(last_error))


def _open_connection(
    *,
    parsed_url: Any,
    timeout_seconds: float,
    connection_factory: ConnectionFactory | None,
) -> HttpConnectionLike:
    connection_kwargs: dict[str, Any] = {"timeout": timeout_seconds}
    if parsed_url.scheme == "https":
        connection_kwargs["context"] = ssl.create_default_context()
        default_factory: ConnectionFactory = http.client.HTTPSConnection
    else:
        default_factory = http.client.HTTPConnection

    factory = connection_factory or default_factory
    return factory(parsed_url.hostname, parsed_url.port, **connection_kwargs)


def _build_request_path(parsed_url: Any) -> str:
    path = parsed_url.path or "/"
    if parsed_url.query:
        return f"{path}?{parsed_url.query}"

    return path


def _should_retry_status(status_code: int, attempt: int, max_attempts: int) -> bool:
    return status_code in RETRYABLE_STATUS_CODES and attempt < max_attempts


def _log_retry(
    error_type: str,
    attempt: int,
    max_attempts: int,
    detail: str,
) -> None:
    logger.warning(
        "DeepSeek request retry: type=%s attempt=%s/%s detail=%s",
        error_type,
        attempt,
        max_attempts,
        detail[:200],
    )


def _sleep_before_retry(retry_delay_seconds: float) -> None:
    if retry_delay_seconds > 0:
        time.sleep(retry_delay_seconds)


def _format_http_status_error(status: int, reason: str, body: bytes) -> str:
    body_text = body.decode("utf-8", errors="replace")
    return (
        f"status={status} reason={reason} "
        f"body={_truncate_error_body(body_text)}"
    ).strip()


def _format_transport_error(error: Exception | None) -> str:
    if error is None:
        return "request failed without detail"

    detail = str(error).strip()
    return f"{error.__class__.__name__}: {detail[:MAX_ERROR_BODY_CHARS]}"


def _truncate_error_body(body: str) -> str:
    normalized_body = " ".join(body.strip().split())
    return normalized_body[:MAX_ERROR_BODY_CHARS]
