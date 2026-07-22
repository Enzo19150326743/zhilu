import json
import unittest
from typing import Any

from app.services.deepseek_client import (
    DeepSeekClientError,
    post_deepseek_chat_completion,
)


class FakeHttpResponse:
    def __init__(
        self,
        status: int,
        body: dict[str, Any],
        reason: str = "OK",
    ) -> None:
        self.status = status
        self.reason = reason
        self._body = json.dumps(body).encode("utf-8")

    def read(self, amount: int | None = None) -> bytes:
        if amount is None:
            return self._body

        return self._body[:amount]


class FakeHttpConnection:
    def __init__(self, result: FakeHttpResponse | Exception) -> None:
        self.result = result
        self.closed = False
        self.request_body: bytes | None = None
        self.request_headers: dict[str, str] = {}
        self.request_method = ""
        self.request_path = ""

    def request(
        self,
        method: str,
        url: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.request_method = method
        self.request_path = url
        self.request_body = body
        self.request_headers = headers or {}
        if isinstance(self.result, Exception):
            raise self.result

    def getresponse(self) -> FakeHttpResponse:
        if isinstance(self.result, Exception):
            raise self.result

        return self.result

    def close(self) -> None:
        self.closed = True


class DeepSeekClientTests(unittest.TestCase):
    def test_retries_transient_transport_error_before_success(self) -> None:
        """
        TLS EOF、连接重置等传输层中断不应立刻让总结回落本地摘要。
        """
        results: list[FakeHttpResponse | Exception] = [
            OSError("server disconnected"),
            FakeHttpResponse(
                status=200,
                body={"choices": [{"message": {"content": "{}"}}]},
            ),
        ]
        connections: list[FakeHttpConnection] = []

        def connection_factory(*_: object, **__: object) -> FakeHttpConnection:
            connection = FakeHttpConnection(results.pop(0))
            connections.append(connection)
            return connection

        response = post_deepseek_chat_completion(
            api_key="test-key",
            base_url="https://api.deepseek.com",
            payload={"model": "deepseek-v4-pro"},
            timeout_seconds=1,
            retry_delay_seconds=0,
            connection_factory=connection_factory,
        )

        self.assertEqual(response["choices"][0]["message"]["content"], "{}")
        self.assertEqual(len(connections), 2)
        self.assertTrue(all(connection.closed for connection in connections))
        self.assertEqual(connections[1].request_method, "POST")
        self.assertEqual(connections[1].request_path, "/chat/completions")
        self.assertEqual(connections[1].request_headers["Connection"], "close")

    def test_http_error_keeps_safe_status_and_body(self) -> None:
        """
        HTTP 错误需要保留状态码和响应正文，便于定位余额、限流或参数问题。
        """
        connections: list[FakeHttpConnection] = []

        def connection_factory(*_: object, **__: object) -> FakeHttpConnection:
            connection = FakeHttpConnection(
                FakeHttpResponse(
                    status=402,
                    reason="Payment Required",
                    body={"error": {"message": "Insufficient Balance"}},
                )
            )
            connections.append(connection)
            return connection

        with self.assertRaises(DeepSeekClientError) as raised:
            post_deepseek_chat_completion(
                api_key="test-key",
                base_url="https://api.deepseek.com",
                payload={"model": "deepseek-v4-pro"},
                timeout_seconds=1,
                retry_delay_seconds=0,
                connection_factory=connection_factory,
            )

        message = str(raised.exception)
        self.assertIn("status=402", message)
        self.assertIn("Payment Required", message)
        self.assertIn("Insufficient Balance", message)
        self.assertNotIn("test-key", message)
        self.assertTrue(connections[0].closed)


if __name__ == "__main__":
    unittest.main()
