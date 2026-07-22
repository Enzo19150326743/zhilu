import base64
import hashlib
import html
import json
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlparse


SUPPORTED_DOUYIN_HOSTS = ("douyin.com", "iesdouyin.com", "amemv.com")


@dataclass(frozen=True)
class DouyinMediaInfo:
    video_id: str
    source_url: str
    title: str
    author: str
    duration_seconds: int
    thumbnail_url: str
    video_url: str
    width: int
    height: int
    file_size: int | None


def supports_douyin_url(source_url: str) -> bool:
    hostname = (urlparse(source_url).hostname or "").lower().rstrip(".")
    return any(
        hostname == supported_host or hostname.endswith(f".{supported_host}")
        for supported_host in SUPPORTED_DOUYIN_HOSTS
    )


def extract_video_id(source_url: str, page_text: str = "") -> str | None:
    parsed_url = urlparse(source_url)
    query = parse_qs(parsed_url.query)
    for key in ("modal_id", "aweme_id", "item_id"):
        candidate = (query.get(key) or [""])[0]
        if candidate.isdigit():
            return candidate

    path_match = re.search(r"/(?:video|note|share/video)/(\d+)", parsed_url.path)
    if path_match:
        return path_match.group(1)

    for pattern in (
        r'["\'](?:aweme_id|awemeId|modal_id)["\']\s*[:=]\s*["\'](\d+)',
        r"data-aweme-id=[\"'](\d+)",
        r"/video/(\d+)",
    ):
        page_match = re.search(pattern, page_text)
        if page_match:
            return page_match.group(1)

    return None


def extract_page_item(page_text: str, video_id: str) -> dict[str, object] | None:
    render_payload = _read_render_payload(page_text)
    render_item = _find_video_item(render_payload, video_id)
    if render_item is not None:
        return render_item

    router_payload = _read_assigned_json(page_text, "window._ROUTER_DATA")
    return _find_video_item(router_payload, video_id)


def solve_challenge_cookie(
    page_text: str,
    *,
    search_limit: int = 1_000_000,
) -> str | None:
    """处理公开分享页返回的计算型验证，不读取或持久化用户 Cookie。"""
    challenge_match = re.search(
        r'wci\s*=\s*["\']([^"\']+)["\']\s*,\s*cs\s*=\s*["\']([^"\']+)',
        page_text,
    )
    if challenge_match is None:
        return None

    cookie_name, encoded_challenge = challenge_match.groups()
    try:
        challenge = json.loads(_decode_base64(encoded_challenge).decode("utf-8"))
        verification = challenge["v"]
        prefix = _decode_base64(str(verification["a"]))
        expected_hash = _decode_base64(str(verification["c"]))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None

    for answer in range(max(0, search_limit) + 1):
        actual_hash = hashlib.sha256(prefix + str(answer).encode()).digest()
        if actual_hash != expected_hash:
            continue

        challenge["d"] = base64.b64encode(str(answer).encode()).decode()
        encoded_value = base64.b64encode(
            json.dumps(challenge, ensure_ascii=False, separators=(",", ":")).encode()
        ).decode()
        return f"{cookie_name}={encoded_value}"

    return None


def build_media_info(
    item: dict[str, object],
    *,
    video_id: str,
    source_url: str,
    resolved_url: str,
) -> DouyinMediaInfo:
    video = _as_dict(item.get("video"))
    if video is None:
        raise ValueError("missing video data")

    media_url = _first_http_url(
        video.get("play_addr"),
        video.get("download_addr"),
        video.get("bit_rate"),
    )
    if media_url is None:
        raise ValueError("missing video url")

    author = _as_dict(item.get("author")) or {}
    cover = _as_dict(video.get("cover")) or _as_dict(video.get("origin_cover")) or {}
    duration_value = _to_int(video.get("duration") or item.get("duration"))

    return DouyinMediaInfo(
        video_id=video_id,
        source_url=resolved_url or source_url,
        title=str(item.get("desc") or item.get("caption") or "抖音公开视频").strip(),
        author=str(author.get("nickname") or "抖音作者"),
        duration_seconds=(
            round(duration_value / 1000)
            if duration_value > 1000
            else max(0, duration_value)
        ),
        thumbnail_url=_first_http_url(cover) or "",
        video_url=media_url.replace("playwm", "play"),
        width=_to_int(video.get("width")),
        height=_to_int(video.get("height")),
        file_size=_positive_int(video.get("data_size") or video.get("size")),
    )


def _read_render_payload(page_text: str) -> object:
    script_match = re.search(
        r'<script[^>]+id=["\']RENDER_DATA["\'][^>]*>(.*?)</script>',
        page_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if script_match is None:
        return None

    try:
        return json.loads(unquote(html.unescape(script_match.group(1))))
    except json.JSONDecodeError:
        return None


def _read_assigned_json(page_text: str, variable_name: str) -> object:
    assignment_match = re.search(
        rf"{re.escape(variable_name)}\s*=\s*",
        page_text,
    )
    if assignment_match is None:
        return None

    start_index = page_text.find("{", assignment_match.end())
    if start_index < 0:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start_index, len(page_text)):
        character = page_text[index]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue

        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(page_text[start_index : index + 1])
                except json.JSONDecodeError:
                    return None

    return None


def _find_video_item(value: object, video_id: str) -> dict[str, object] | None:
    if isinstance(value, dict):
        candidate_id = value.get("aweme_id") or value.get("awemeId") or value.get("id")
        if str(candidate_id or "") == video_id and isinstance(value.get("video"), dict):
            return value

        for child in value.values():
            found = _find_video_item(child, video_id)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_video_item(child, video_id)
            if found is not None:
                return found

    return None


def _first_http_url(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value.strip()
        if isinstance(value, dict):
            preferred = _first_http_url(value.get("url_list"))
            if preferred:
                return preferred
            nested = _first_http_url(*value.values())
            if nested:
                return nested
        if isinstance(value, list):
            nested = _first_http_url(*value)
            if nested:
                return nested

    return None


def _decode_base64(value: str) -> bytes:
    normalized = value.replace("-", "+").replace("_", "/")
    return base64.b64decode(normalized + "=" * (-len(normalized) % 4))


def _as_dict(value: object) -> dict[str, object] | None:
    return value if isinstance(value, dict) else None


def _positive_int(value: object) -> int | None:
    parsed = _to_int(value)
    return parsed if parsed > 0 else None


def _to_int(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
