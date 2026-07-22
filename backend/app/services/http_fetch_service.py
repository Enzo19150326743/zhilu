import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlparse

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
MAX_PUBLIC_FETCH_BYTES = 5 * 1024 * 1024
BLOCKED_HOSTS = {"localhost"}


def fetch_public_bytes(
    source_url: str,
    *,
    accept_header: str,
    timeout_seconds: float,
    max_bytes: int = MAX_PUBLIC_FETCH_BYTES,
) -> tuple[bytes, str]:
    """
    读取公开 HTTP(S) 资源。

    NOTE: 本机环境中 urllib/httpx 对部分 HTTPS 站点会触发 TLS EOF；
    http.client + Connection: close 在相同网络下更稳定，且不会引入浏览器自动登录态。
    """
    parsed_url = urlparse(source_url)
    validate_public_http_url(parsed_url.hostname, parsed_url.scheme)

    connection_class = (
        http.client.HTTPSConnection
        if parsed_url.scheme == "https"
        else http.client.HTTPConnection
    )
    connection_kwargs = {"timeout": timeout_seconds}
    if parsed_url.scheme == "https":
        connection_kwargs["context"] = ssl.create_default_context()

    path = parsed_url.path or "/"
    if parsed_url.query:
        path = f"{path}?{parsed_url.query}"

    connection = connection_class(parsed_url.hostname, parsed_url.port, **connection_kwargs)
    try:
        connection.request(
            "GET",
            path,
            headers={
                "Accept": accept_header,
                "Accept-Encoding": "identity",
                "Connection": "close",
                "User-Agent": DEFAULT_USER_AGENT,
            },
        )
        response = connection.getresponse()
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise OSError("public resource is too large")

        if response.status >= 400:
            raise OSError(f"public resource returned status={response.status}")

        content_type = response.getheader("Content-Type") or "application/octet-stream"
        return body, content_type
    finally:
        connection.close()


def fetch_public_text(
    source_url: str,
    *,
    accept_header: str,
    timeout_seconds: float,
) -> str:
    body, content_type = fetch_public_bytes(
        source_url,
        accept_header=accept_header,
        timeout_seconds=timeout_seconds,
    )
    charset = _extract_charset(content_type)
    return body.decode(charset, errors="replace")


def validate_public_http_url(hostname: str | None, scheme: str) -> None:
    if scheme not in {"http", "https"} or not hostname:
        raise OSError("only public http or https URLs are supported")

    normalized_hostname = hostname.lower()
    if normalized_hostname in BLOCKED_HOSTS:
        raise OSError("local host URLs are not allowed")

    try:
        ip_address = ipaddress.ip_address(normalized_hostname)
    except ValueError:
        _validate_resolved_addresses(normalized_hostname)
        return

    if _is_private_address(ip_address):
        raise OSError("private network URLs are not allowed")


def _validate_resolved_addresses(hostname: str) -> None:
    try:
        address_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as error:
        raise OSError("host cannot be resolved") from error

    for address_info in address_infos:
        address = address_info[4][0]
        try:
            ip_address = ipaddress.ip_address(address)
        except ValueError:
            continue

        if _is_private_address(ip_address):
            raise OSError("private network URLs are not allowed")


def _is_private_address(ip_address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip_address.is_private
        or ip_address.is_loopback
        or ip_address.is_link_local
        or ip_address.is_multicast
        or ip_address.is_reserved
    )


def _extract_charset(content_type: str) -> str:
    for part in content_type.split(";"):
        key, separator, value = part.strip().partition("=")
        if separator and key.lower() == "charset" and value.strip():
            return value.strip()

    return "utf-8"
