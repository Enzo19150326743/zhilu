import html
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from urllib.parse import quote, urlparse
from xml.etree import ElementTree

from fastapi import HTTPException

from app.schemas import ParseResponse, TranscriptPayload, TranscriptSegment
from app.services.http_fetch_service import fetch_public_text

logger = logging.getLogger(__name__)

RSSHUB_TIMEOUT_SECONDS = 15
DEFAULT_RSSHUB_BASE_URL = "https://rsshub.app"
ITUNES_NAMESPACE = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
CONTENT_NAMESPACE = "{http://purl.org/rss/1.0/modules/content/}"
PLACEHOLDER_THUMBNAIL = (
    "https://images.unsplash.com/photo-1478737270239-2f02b77fc618"
    "?auto=format&fit=crop&w=900&q=80"
)


@dataclass(frozen=True)
class XiaoyuzhouEpisode:
    episode_id: str
    source_url: str
    audio_url: str
    title: str
    podcast_title: str
    author: str
    duration: int
    thumbnail: str
    shownotes_text: str


def is_xiaoyuzhou_url(source_url: str) -> bool:
    """
    判断是否为小宇宙网页 URL。
    """
    parsed_url = urlparse(source_url)
    hostname = parsed_url.hostname or ""
    return hostname.endswith("xiaoyuzhoufm.com")


def is_xiaoyuzhou_episode_url(source_url: str) -> bool:
    """
    判断是否为小宇宙公开单集 URL。
    """
    parsed_url = urlparse(source_url)
    path_parts = _get_path_parts(parsed_url.path)
    return (
        is_xiaoyuzhou_url(source_url)
        and len(path_parts) >= 2
        and path_parts[0] == "episode"
        and bool(path_parts[1])
    )


def parse_xiaoyuzhou_episode(source_url: str) -> ParseResponse:
    """
    解析小宇宙公开单集 shownotes，并转换为现有工作台结构。
    """
    episode_id = _extract_episode_id(source_url)
    try:
        rss_text = _fetch_episode_rss(episode_id)
        episode = _parse_episode_rss(source_url, episode_id, rss_text)
    except HTTPException as error:
        logger.warning("xiaoyuzhou rss path failed, falling back to webpage")
        if _get_error_code(error) not in {
            "XIAOYUZHOU_RSS_FETCH_FAILED",
            "XIAOYUZHOU_RSS_PARSE_FAILED",
            "XIAOYUZHOU_EPISODE_NOT_FOUND",
        }:
            raise

        page_html = _fetch_episode_page(source_url)
        episode = _parse_episode_page(source_url, episode_id, page_html)

    transcript = _build_shownotes_transcript(episode.shownotes_text)

    return ParseResponse(
        source_url=source_url,
        is_placeholder=False,
        video={
            "video_id": f"xiaoyuzhou_{episode.episode_id}",
            "platform": "xiaoyuzhou",
            "url": episode.source_url,
            "title": episode.title,
            "author": episode.author,
            "duration": episode.duration,
            "thumbnail": episode.thumbnail,
            "has_transcript": bool(episode.shownotes_text.strip()),
            "media_type": "podcast",
            "text_source_type": "shownotes",
        },
        formats=[],
        transcript=transcript,
        summary=_build_summary_placeholder(episode),
        mindmap_markdown=_build_mindmap_placeholder(episode),
        transcription_source_url=episode.audio_url or None,
        shownotes_plain_text=episode.shownotes_text or None,
    )


def _extract_episode_id(source_url: str) -> str:
    parsed_url = urlparse(source_url)
    path_parts = _get_path_parts(parsed_url.path)
    if len(path_parts) < 2 or path_parts[0] != "episode":
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_INVALID_URL",
            "请输入公开小宇宙单集链接，当前不支持整档播客批量导入。",
        )

    return path_parts[1]


def _get_path_parts(path: str) -> list[str]:
    return [part for part in PurePosixPath(path).parts if part not in {"/", ""}]


def _fetch_episode_rss(episode_id: str) -> str:
    base_url = os.getenv("XIAOYUZHOU_RSSHUB_BASE_URL", DEFAULT_RSSHUB_BASE_URL)
    normalized_base_url = base_url.rstrip("/")
    rss_url = f"{normalized_base_url}/xiaoyuzhou/podcast/{quote(episode_id)}"
    try:
        return fetch_public_text(
            rss_url,
            accept_header="application/rss+xml,application/xml,text/xml,*/*",
            timeout_seconds=RSSHUB_TIMEOUT_SECONDS,
        )
    except OSError as error:
        logger.warning("xiaoyuzhou rss fetch failed: %s", error.__class__.__name__)
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_RSS_FETCH_FAILED",
            "小宇宙公开 RSS 读取失败，请稍后重试或检查 RSSHub 配置。",
        ) from error


def _fetch_episode_page(source_url: str) -> str:
    try:
        return fetch_public_text(
            source_url,
            accept_header="text/html,application/xhtml+xml,*/*",
            timeout_seconds=RSSHUB_TIMEOUT_SECONDS,
        )
    except OSError as error:
        logger.warning("xiaoyuzhou page fetch failed: %s", error.__class__.__name__)
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_PAGE_FETCH_FAILED",
            "小宇宙公开网页读取失败，请稍后重试。",
        ) from error


def _parse_episode_rss(
    source_url: str,
    episode_id: str,
    rss_text: str,
) -> XiaoyuzhouEpisode:
    try:
        root = ElementTree.fromstring(rss_text)
    except ElementTree.ParseError as error:
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_RSS_PARSE_FAILED",
            "小宇宙公开 RSS 解析失败，请稍后重试。",
        ) from error

    channel = root.find("channel")
    if channel is None:
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_RSS_PARSE_FAILED",
            "小宇宙公开 RSS 缺少频道信息。",
        )

    items = channel.findall("item")
    item = _select_episode_item(items, episode_id)
    if item is None:
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_EPISODE_NOT_FOUND",
            "未在公开 RSS 中找到该小宇宙单集。",
        )

    podcast_title = _get_child_text(channel, "title") or "小宇宙播客"
    title = _get_child_text(item, "title") or podcast_title
    shownotes_text = _clean_html_text(
        _get_child_text(item, f"{CONTENT_NAMESPACE}encoded")
        or _get_child_text(item, "description")
        or ""
    )

    return XiaoyuzhouEpisode(
        episode_id=episode_id,
        source_url=_get_child_text(item, "link") or source_url,
        audio_url=_get_enclosure_url(item),
        title=title,
        podcast_title=podcast_title,
        author=(
            _get_child_text(item, f"{ITUNES_NAMESPACE}author")
            or _get_child_text(channel, f"{ITUNES_NAMESPACE}author")
            or podcast_title
        ),
        duration=_parse_duration(_get_child_text(item, f"{ITUNES_NAMESPACE}duration")),
        thumbnail=_get_episode_image(item) or _get_channel_image(channel),
        shownotes_text=shownotes_text,
    )


def _parse_episode_page(
    source_url: str,
    episode_id: str,
    page_html: str,
) -> XiaoyuzhouEpisode:
    """
    从小宇宙公开网页的 Next.js 数据中解析单集信息。
    """
    next_data = _extract_next_data(page_html)
    episode_payload = _get_nested_dict(next_data, ("props", "pageProps", "episode"))
    if episode_payload:
        return _build_episode_from_page_payload(source_url, episode_id, episode_payload)

    json_ld = _extract_json_ld(page_html)
    if json_ld:
        return _build_episode_from_json_ld(source_url, episode_id, json_ld, page_html)

    raise _build_xiaoyuzhou_error(
        "XIAOYUZHOU_PAGE_PARSE_FAILED",
        "小宇宙公开网页解析失败，请稍后重试。",
    )


def _extract_next_data(page_html: str) -> dict[str, object]:
    match = re.search(
        r'<script\s+id="__NEXT_DATA__"\s+type="application/json">([\s\S]*?)</script>',
        page_html,
    )
    if match is None:
        return {}

    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        logger.warning("xiaoyuzhou next data json parse failed")
        return {}

    return payload if isinstance(payload, dict) else {}


def _extract_json_ld(page_html: str) -> dict[str, object]:
    match = re.search(
        r'<script\s+name="schema:podcast-show"\s+type="application/ld\+json">([\s\S]*?)</script>',
        page_html,
    )
    if match is None:
        return {}

    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        logger.warning("xiaoyuzhou json-ld parse failed")
        return {}

    return payload if isinstance(payload, dict) else {}


def _build_episode_from_page_payload(
    source_url: str,
    episode_id: str,
    episode_payload: dict[str, object],
) -> XiaoyuzhouEpisode:
    if _is_restricted_episode_payload(episode_payload):
        raise _build_xiaoyuzhou_error(
            "XIAOYUZHOU_ACCESS_RESTRICTED",
            "该小宇宙单集存在付费、私密或访问限制，当前只支持公开内容。",
        )

    podcast_payload = _as_dict(episode_payload.get("podcast"))
    title = _as_text(episode_payload.get("title")) or "未命名小宇宙单集"
    podcast_title = _as_text(podcast_payload.get("title")) or "小宇宙播客"
    shownotes_html = _as_text(episode_payload.get("shownotes"))
    description = _as_text(episode_payload.get("description"))

    return XiaoyuzhouEpisode(
        episode_id=_as_text(episode_payload.get("eid")) or episode_id,
        source_url=source_url,
        audio_url=_extract_audio_url_from_payload(episode_payload),
        title=title,
        podcast_title=podcast_title,
        author=_as_text(podcast_payload.get("author")) or podcast_title,
        duration=_parse_duration(_as_text(episode_payload.get("duration"))),
        thumbnail=(
            _get_picture_url(_as_dict(episode_payload.get("image")))
            or _get_picture_url(_as_dict(podcast_payload.get("image")))
            or PLACEHOLDER_THUMBNAIL
        ),
        shownotes_text=_clean_html_text(shownotes_html or description),
    )


def _build_episode_from_json_ld(
    source_url: str,
    episode_id: str,
    json_ld: dict[str, object],
    page_html: str,
) -> XiaoyuzhouEpisode:
    series = _as_dict(json_ld.get("partOfSeries"))
    title = _as_text(json_ld.get("name")) or "未命名小宇宙单集"
    podcast_title = _as_text(series.get("name")) or "小宇宙播客"

    return XiaoyuzhouEpisode(
        episode_id=episode_id,
        source_url=_as_text(json_ld.get("url")) or source_url,
        audio_url=(
            _extract_audio_url_from_payload(json_ld)
            or _extract_audio_url_from_html(page_html)
        ),
        title=title,
        podcast_title=podcast_title,
        author=podcast_title,
        duration=_parse_duration(_as_text(json_ld.get("timeRequired"))),
        thumbnail=_extract_meta_content(page_html, "og:image") or PLACEHOLDER_THUMBNAIL,
        shownotes_text=_as_text(json_ld.get("description")),
    )


def _get_nested_dict(
    payload: dict[str, object],
    path: tuple[str, ...],
) -> dict[str, object]:
    current: object = payload
    for key in path:
        current = _as_dict(current).get(key)

    return _as_dict(current)


def _as_dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _as_text(value: object) -> str:
    if value is None:
        return ""

    return str(value).strip()


def _extract_audio_url_from_payload(payload: dict[str, object]) -> str:
    """
    从公开页面结构化数据中尽量找音频 URL，供本地 ASR 使用。
    """
    direct_keys = (
        "audioUrl",
        "audio_url",
        "mediaUrl",
        "media_url",
        "playUrl",
        "play_url",
        "src",
        "url",
    )
    for key in direct_keys:
        value = _as_text(payload.get(key))
        if _looks_like_audio_url(value):
            return value

    for value in payload.values():
        if isinstance(value, dict):
            nested_url = _extract_audio_url_from_payload(value)
            if nested_url:
                return nested_url
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    nested_url = _extract_audio_url_from_payload(item)
                    if nested_url:
                        return nested_url
                item_text = _as_text(item)
                if _looks_like_audio_url(item_text):
                    return item_text

    return ""


def _extract_audio_url_from_html(page_html: str) -> str:
    match = re.search(
        r"https?://[^\"'\\\s<>]+?\.(?:mp3|m4a|aac)(?:\?[^\"'\\\s<>]*)?",
        page_html,
    )
    if match is None:
        return ""

    return html.unescape(match.group(0))


def _looks_like_audio_url(value: str) -> bool:
    if not value.startswith(("http://", "https://")):
        return False

    parsed_path = urlparse(value).path.lower()
    return parsed_path.endswith((".mp3", ".m4a", ".aac", ".wav", ".ogg"))


def _get_picture_url(picture_payload: dict[str, object]) -> str:
    for key in ("picUrl", "largePicUrl", "middlePicUrl", "thumbnailUrl"):
        value = _as_text(picture_payload.get(key))
        if value:
            return value

    return ""


def _is_restricted_episode_payload(episode_payload: dict[str, object]) -> bool:
    if bool(episode_payload.get("isPrivateMedia")):
        return True

    pay_type = _as_text(episode_payload.get("payType")).upper()
    return bool(pay_type and pay_type != "FREE")


def _extract_meta_content(page_html: str, property_name: str) -> str:
    pattern = (
        rf'<meta\s+(?:property|name)="{re.escape(property_name)}"\s+content="([^"]*)"'
    )
    match = re.search(pattern, page_html)
    if match is None:
        return ""

    return html.unescape(match.group(1)).strip()


def _select_episode_item(
    items: list[ElementTree.Element],
    episode_id: str,
) -> ElementTree.Element | None:
    if len(items) == 1:
        return items[0]

    for item in items:
        values = [
            _get_child_text(item, "guid"),
            _get_child_text(item, "link"),
            _get_enclosure_url(item),
        ]
        if any(episode_id in value for value in values if value):
            return item

    return items[0] if items else None


def _get_child_text(element: ElementTree.Element, tag_name: str) -> str:
    child = element.find(tag_name)
    if child is None or child.text is None:
        return ""

    return child.text.strip()


def _get_episode_image(item: ElementTree.Element) -> str:
    image = item.find(f"{ITUNES_NAMESPACE}image")
    if image is None:
        return ""

    return str(image.attrib.get("href") or "").strip()


def _get_channel_image(channel: ElementTree.Element) -> str:
    itunes_image = channel.find(f"{ITUNES_NAMESPACE}image")
    if itunes_image is not None:
        href = str(itunes_image.attrib.get("href") or "").strip()
        if href:
            return href

    image_url = channel.find("image/url")
    if image_url is not None and image_url.text:
        return image_url.text.strip()

    return PLACEHOLDER_THUMBNAIL


def _get_enclosure_url(item: ElementTree.Element) -> str:
    enclosure = item.find("enclosure")
    if enclosure is None:
        return ""

    return str(enclosure.attrib.get("url") or "").strip()


def _parse_duration(duration_text: str) -> int:
    if not duration_text:
        return 0

    iso_match = re.fullmatch(
        r"P(?:T)?(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?",
        duration_text,
    )
    if iso_match:
        return (
            int(iso_match.group("hours") or 0) * 3600
            + int(iso_match.group("minutes") or 0) * 60
            + int(iso_match.group("seconds") or 0)
        )

    if duration_text.isdigit():
        return int(duration_text)

    parts = duration_text.split(":")
    try:
        seconds = 0
        for part in parts:
            seconds = seconds * 60 + int(part)
        return seconds
    except ValueError:
        return 0


def _clean_html_text(raw_text: str) -> str:
    text = html.unescape(raw_text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _build_shownotes_transcript(shownotes_text: str) -> TranscriptPayload:
    text = shownotes_text.strip() or "该公开单集没有可用 shownotes。"
    paragraphs = _split_shownotes_paragraphs(text)
    return TranscriptPayload(
        segments=[
            TranscriptSegment(start=0, end=0, text=paragraph)
            for paragraph in paragraphs
        ],
        plain_text=text,
    )


def _split_shownotes_paragraphs(text: str) -> list[str]:
    """
    将 shownotes 拆成可读段落，避免前端把简介当成单条字幕。
    """
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n+", text)
        if paragraph.strip()
    ]
    return paragraphs or [text]


def _build_summary_placeholder(episode: XiaoyuzhouEpisode) -> dict[str, object]:
    return {
        "tldr": "已解析公开小宇宙单集元数据和 shownotes，可基于 shownotes 生成结构化总结。",
        "key_points": [
            f"播客：{episode.podcast_title}",
            f"单集：{episode.title}",
            "当前只解析公开网页和公开 RSS 元数据，不读取登录态或付费内容。",
            "可基于 shownotes 总结和问答；AI 转写稿可在工作台手动生成。",
        ],
        "timeline": [],
        "structured_analysis_markdown": (
            f"## {episode.title}\n"
            f"### 播客\n{episode.podcast_title}\n"
            "### 当前阶段\n"
            "已完成公开单集元数据与 shownotes 解析。\n"
            "### 后续\n"
            "可基于 shownotes 生成摘要和问答；如需完整音频文本，可在工作台手动生成 AI 转写稿。"
        ),
        "takeaways": [
            "优先用公开 shownotes 做低成本内容理解。",
            "如果 shownotes 信息不足，可尝试生成 AI 转写稿后再总结。",
        ],
    }


def _build_mindmap_placeholder(episode: XiaoyuzhouEpisode) -> str:
    return (
        f"# {episode.title}\n"
        f"## 播客\n### {episode.podcast_title}\n"
        "## 已解析\n### 公开元数据\n### shownotes\n"
        "## 可继续\n### AI 总结\n### 生成 AI 转写稿\n### QA"
    )


def _build_xiaoyuzhou_error(error_code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"success": False, "error_code": error_code, "message": message},
    )


def _get_error_code(error: HTTPException) -> str:
    detail = error.detail
    if isinstance(detail, dict):
        return str(detail.get("error_code") or "")

    return ""
