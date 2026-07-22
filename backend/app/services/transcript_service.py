import html
import json
import logging
import re
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from app.schemas import TranscriptPayload, TranscriptSegment

logger = logging.getLogger(__name__)

BILIBILI_BVID_PATTERN = re.compile(r"BV[a-zA-Z0-9]{10}")
BILIBILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view"
BILIBILI_DM_VIEW_API = "https://api.bilibili.com/x/v2/dm/view"
BILIBILI_JSON_ACCEPT_HEADER = "application/json,text/plain,*/*"
PREFERRED_LANGUAGES = ("zh-Hans", "zh-CN", "zh", "zh-Hant", "en")
SUPPORTED_SUBTITLE_EXTENSIONS = ("vtt", "srt")
SUBTITLE_TIMEOUT_SECONDS = 12


def extract_transcript_payload(raw_info: dict[str, Any]) -> TranscriptPayload:
    """
    从平台字幕或 yt-dlp 字幕候选中选择并解析一份字幕。

    NOTE: B 站公开字幕优先走平台接口，避免 yt-dlp 未暴露字幕候选时误判为无文本。
    """
    bilibili_transcript = _extract_bilibili_transcript(raw_info)
    if bilibili_transcript is not None:
        return bilibili_transcript

    subtitle_candidate = _select_subtitle_candidate(raw_info)
    if subtitle_candidate is None:
        return _build_placeholder_transcript("未检测到可用 VTT/SRT 字幕。")

    subtitle_url = subtitle_candidate.get("url")
    extension = str(subtitle_candidate.get("ext") or "").lower()
    if not isinstance(subtitle_url, str) or not subtitle_url:
        return _build_placeholder_transcript("字幕候选缺少可读取地址。")

    try:
        subtitle_content = _fetch_subtitle_text(subtitle_url)
    except OSError as error:
        logger.warning("subtitle fetch failed: %s", error.__class__.__name__)
        return _build_placeholder_transcript("内容文本下载失败，稍后可重试或换一个公开媒体链接。")

    segments = _parse_subtitle_text(subtitle_content, extension)
    if not segments:
        return _build_placeholder_transcript("字幕解析失败，当前字幕格式暂不支持。")

    plain_text = " ".join(segment.text for segment in segments)
    return TranscriptPayload(segments=segments, plain_text=plain_text)


def has_supported_subtitle(raw_info: dict[str, Any]) -> bool:
    """
    判断 yt-dlp 输出中是否存在本轮可处理的字幕候选。
    """
    return _select_subtitle_candidate(raw_info) is not None


def _extract_bilibili_transcript(
    raw_info: dict[str, Any]
) -> TranscriptPayload | None:
    if not _is_bilibili_info(raw_info):
        return None

    bvid = _extract_bvid(raw_info)
    if not bvid:
        return None

    referer = f"https://www.bilibili.com/video/{bvid}"
    try:
        view_data = _fetch_bilibili_json(
            f"{BILIBILI_VIEW_API}?{urlencode({'bvid': bvid})}",
            referer,
        )
        media_data = _get_dict(view_data.get("data"))
        aid = _safe_positive_int(media_data.get("aid") or raw_info.get("aid"))
        cid = _safe_positive_int(raw_info.get("cid") or media_data.get("cid"))
        if cid is None:
            cid = _extract_first_page_cid(media_data)
        if aid is None or cid is None:
            return None

        dm_data = _fetch_bilibili_json(
            f"{BILIBILI_DM_VIEW_API}?{urlencode({'aid': aid, 'oid': cid, 'type': 1})}",
            referer,
        )
        subtitles = _get_bilibili_subtitles(dm_data)
        subtitle_item = _select_bilibili_subtitle(subtitles)
        if subtitle_item is None:
            return None

        subtitle_url = _normalize_bilibili_subtitle_url(
            str(subtitle_item.get("subtitle_url") or "")
        )
        if not subtitle_url:
            return None

        subtitle_data = _fetch_bilibili_json(subtitle_url, referer)
        segments = _parse_bilibili_subtitle_segments(subtitle_data)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        logger.warning("bilibili subtitle fetch failed: %s", error.__class__.__name__)
        return None

    if not segments:
        return None

    return TranscriptPayload(
        segments=segments,
        plain_text=" ".join(segment.text for segment in segments),
    )


def _is_bilibili_info(raw_info: dict[str, Any]) -> bool:
    extractor_key = str(raw_info.get("extractor_key") or raw_info.get("extractor") or "")
    if "bilibili" in extractor_key.lower():
        return True

    for key in ("webpage_url", "original_url", "url"):
        hostname = urlparse(str(raw_info.get(key) or "")).hostname or ""
        if hostname.endswith("bilibili.com") or hostname.endswith("b23.tv"):
            return True

    return False


def _extract_bvid(raw_info: dict[str, Any]) -> str | None:
    raw_id = str(raw_info.get("id") or "")
    if BILIBILI_BVID_PATTERN.fullmatch(raw_id):
        return raw_id

    for key in ("webpage_url", "original_url", "url"):
        match = BILIBILI_BVID_PATTERN.search(str(raw_info.get(key) or ""))
        if match:
            return match.group(0)

    return None


def _fetch_bilibili_json(source_url: str, referer: str) -> dict[str, Any]:
    body = _fetch_text(
        source_url,
        accept_header=BILIBILI_JSON_ACCEPT_HEADER,
        referer=referer,
    )
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("bilibili json response is not an object")

    return data


def _get_bilibili_subtitles(dm_data: dict[str, Any]) -> list[dict[str, Any]]:
    data = _get_dict(dm_data.get("data"))
    subtitle_data = _get_dict(data.get("subtitle"))
    subtitles = subtitle_data.get("subtitles")
    if not isinstance(subtitles, list):
        return []

    return [item for item in subtitles if isinstance(item, dict)]


def _select_bilibili_subtitle(
    subtitles: list[dict[str, Any]]
) -> dict[str, Any] | None:
    if not subtitles:
        return None

    def rank(subtitle: dict[str, Any]) -> tuple[int, int]:
        language = str(subtitle.get("lan") or "")
        normalized_language = language[3:] if language.startswith("ai-") else language
        try:
            language_rank = PREFERRED_LANGUAGES.index(normalized_language)
        except ValueError:
            language_rank = len(PREFERRED_LANGUAGES)

        auto_rank = 1 if language.startswith("ai-") else 0
        return (language_rank, auto_rank)

    return min(subtitles, key=rank)


def _normalize_bilibili_subtitle_url(subtitle_url: str) -> str | None:
    if not subtitle_url:
        return None
    if subtitle_url.startswith("//"):
        return f"https:{subtitle_url}"
    if subtitle_url.startswith("http://"):
        return f"https://{subtitle_url[7:]}"
    if subtitle_url.startswith("https://"):
        return subtitle_url

    return None


def _parse_bilibili_subtitle_segments(
    subtitle_data: dict[str, Any]
) -> list[TranscriptSegment]:
    body = subtitle_data.get("body")
    if not isinstance(body, list):
        return []

    segments = []
    previous_text = ""
    for item in body:
        if not isinstance(item, dict):
            continue

        text = _clean_plain_text(str(item.get("content") or ""))
        if not text or text == previous_text:
            continue

        start = _safe_float(item.get("from"))
        end = _safe_float(item.get("to"))
        if start is None or end is None:
            continue

        previous_text = text
        segments.append(TranscriptSegment(start=start, end=end, text=text))

    return segments


def _extract_first_page_cid(media_data: dict[str, Any]) -> int | None:
    pages = media_data.get("pages")
    if not isinstance(pages, list) or not pages:
        return None

    first_page = pages[0]
    if not isinstance(first_page, dict):
        return None

    return _safe_positive_int(first_page.get("cid"))


def _fetch_text(source_url: str, accept_header: str, referer: str | None = None) -> str:
    headers = {
        "Accept": accept_header,
        "Accept-Encoding": "identity",
        "User-Agent": "Mozilla/5.0",
    }
    if referer:
        headers["Referer"] = referer

    request = Request(source_url, headers=headers)
    with urlopen(request, timeout=SUBTITLE_TIMEOUT_SECONDS) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def _get_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_positive_int(value: Any) -> int | None:
    try:
        integer_value = int(value)
    except (TypeError, ValueError):
        return None

    return integer_value if integer_value > 0 else None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean_plain_text(text: str) -> str:
    normalized_text = html.unescape(text)
    return re.sub(r"\s+", " ", normalized_text).strip()


def _select_subtitle_candidate(raw_info: dict[str, Any]) -> dict[str, Any] | None:
    subtitles = raw_info.get("subtitles")
    automatic_captions = raw_info.get("automatic_captions")

    for subtitle_group in (subtitles, automatic_captions):
        if not isinstance(subtitle_group, dict) or not subtitle_group:
            continue

        candidate = _select_candidate_from_group(subtitle_group)
        if candidate is not None:
            return candidate

    return None


def _select_candidate_from_group(
    subtitle_group: dict[str, Any]
) -> dict[str, Any] | None:
    language_keys = list(subtitle_group.keys())
    ordered_languages = [
        language
        for language in PREFERRED_LANGUAGES
        if language in subtitle_group
    ]
    ordered_languages.extend(
        language for language in language_keys if language not in ordered_languages
    )

    for language in ordered_languages:
        candidates = subtitle_group.get(language)
        if not isinstance(candidates, list):
            continue

        for extension in SUPPORTED_SUBTITLE_EXTENSIONS:
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue

                candidate_extension = str(candidate.get("ext") or "").lower()
                if candidate_extension == extension and candidate.get("url"):
                    return candidate

    return None


def _fetch_subtitle_text(subtitle_url: str) -> str:
    return _fetch_text(
        subtitle_url,
        accept_header="text/vtt,application/x-subrip,text/plain,*/*",
    )


def _parse_subtitle_text(
    subtitle_content: str, extension: str
) -> list[TranscriptSegment]:
    normalized_content = subtitle_content.replace("\ufeff", "").replace("\r\n", "\n")
    if extension == "srt":
        return _parse_timed_blocks(normalized_content)

    return _parse_timed_blocks(_strip_vtt_metadata(normalized_content))


def _strip_vtt_metadata(subtitle_content: str) -> str:
    lines = []
    for line in subtitle_content.split("\n"):
        stripped_line = line.strip()
        if stripped_line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        lines.append(line)

    return "\n".join(lines)


def _parse_timed_blocks(subtitle_content: str) -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    previous_text = ""

    for block in re.split(r"\n\s*\n", subtitle_content):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if not lines:
            continue

        timestamp_index = _find_timestamp_line_index(lines)
        if timestamp_index is None:
            continue

        try:
            start, end = _parse_timestamp_range(lines[timestamp_index])
        except ValueError:
            continue

        text = _clean_subtitle_text(lines[timestamp_index + 1 :])
        if not text or text == previous_text:
            continue

        previous_text = text
        segments.append(TranscriptSegment(start=start, end=end, text=text))

    return segments


def _find_timestamp_line_index(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        if "-->" in line:
            return index

    return None


def _parse_timestamp_range(timestamp_line: str) -> tuple[float, float]:
    start_text, end_text = timestamp_line.split("-->", maxsplit=1)
    end_text = end_text.strip().split(" ", maxsplit=1)[0]
    return _parse_timestamp(start_text.strip()), _parse_timestamp(end_text.strip())


def _parse_timestamp(timestamp_text: str) -> float:
    normalized_timestamp = timestamp_text.replace(",", ".")
    parts = normalized_timestamp.split(":")

    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + float(part)

    return seconds


def _clean_subtitle_text(text_lines: list[str]) -> str:
    cleaned_lines = []
    for line in text_lines:
        text = re.sub(r"<[^>]+>", "", line)
        text = re.sub(r"\d{2}:\d{2}:\d{2}\.\d{3}", "", text)
        text = re.sub(r"\d{2}:\d{2}\.\d{3}", "", text)
        text = html.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            cleaned_lines.append(text)

    return " ".join(cleaned_lines).strip()


def _build_placeholder_transcript(message: str) -> TranscriptPayload:
    return TranscriptPayload(
        segments=[TranscriptSegment(start=0, end=0, text=message)],
        plain_text=message,
    )
