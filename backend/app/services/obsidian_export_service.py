import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from app.schemas import (
    ObsidianNoteExportResponse,
    ParseResponse,
    SummaryHighlight,
)
from app.services.library_service import get_library_detail_by_source_url
from app.services.summarize_service import UNIVERSAL_KNOWLEDGE_DRAFT_VERSION


class ObsidianExportError(ValueError):
    """Obsidian 导出业务错误。"""

    def __init__(self, error_code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


MEDIA_CONTENT_TYPE_LABELS = {
    "video": "视频",
    "podcast": "播客",
}
PLATFORM_LABELS = {
    "douyin": "抖音",
    "xiaoyuzhou": "小宇宙",
    "bilibili": "B 站",
    "xiaohongshu": "小红书",
}
DEFAULT_EXPORT_SUBDIR = "知录知识稿"


def export_obsidian_note(
    source_url: str,
    include_full_text: bool = False,
) -> ObsidianNoteExportResponse:
    """
    生成 Obsidian Markdown；配置 vault 写入时只允许写到 vault 内部。
    """
    detail = get_library_detail_by_source_url(source_url)
    if detail is None:
        raise ObsidianExportError(
            "LIBRARY_ITEM_NOT_FOUND",
            "没有找到可导出的本地历史记录。",
            status_code=404,
        )

    markdown = build_obsidian_markdown(detail, include_full_text=include_full_text)
    filename = f"{_sanitize_filename(detail.video.title)}.md"
    target_path = _write_markdown_if_enabled(filename, markdown)
    if target_path is None:
        return ObsidianNoteExportResponse(
            filename=filename,
            written_to_vault=False,
            file_path=None,
            markdown=markdown,
            message="未启用 Obsidian vault 写入，已返回 Markdown 文件内容。",
        )

    return ObsidianNoteExportResponse(
        filename=target_path.name,
        written_to_vault=True,
        file_path=str(target_path),
        markdown=markdown,
        message="已写入 Obsidian vault。",
    )


def build_obsidian_markdown(
    detail: ParseResponse,
    include_full_text: bool = False,
) -> str:
    video = detail.video
    summary = detail.summary
    # NOTE: 只有用户确认过的摘录进入文档；未确认的 AI 候选摘录一律不导出。
    confirmed_highlights = _deduplicate_highlights(
        detail.note_draft.highlights if detail.note_draft else []
    )
    frontmatter = _build_frontmatter(detail)
    # NOTE: 深入区块由 AI 按文本证据决定，导出时直接保留其具体标题，
    # 不再包裹一个没有信息量的固定“结构化分析”标题。
    content_structure = _format_content_structure(detail)
    sections = [
        frontmatter,
        f"# {video.title}",
        "## 一句话结论",
        summary.tldr,
        f"## {summary.key_points_title or '内容要点'}",
        _format_markdown_list(summary.key_points),
    ]
    methods = _format_methods(detail)
    if methods:
        sections.extend([f"## {summary.method_title or '可借鉴的方法'}", methods])
    content_outline = _format_content_outline(detail)
    if content_outline:
        sections.extend(["## 内容脉络", content_outline])
    if content_structure:
        sections.append(content_structure)
    if confirmed_highlights:
        sections.extend(["## 我的整理", _format_highlights(confirmed_highlights)])
    sections.extend(
        [
            "## 内容边界与待核实信息",
            _format_content_boundaries(detail, include_full_text),
        ]
    )

    return "\n\n".join(section.strip() for section in sections if section.strip()) + "\n"


def _build_frontmatter(detail: ParseResponse) -> str:
    video = detail.video
    values: dict[str, object] = {
        "草稿版本": UNIVERSAL_KNOWLEDGE_DRAFT_VERSION,
        "标题": video.title,
        "内容类型": _infer_content_type(detail),
        "平台": PLATFORM_LABELS.get(video.platform, video.platform),
        "原始作者": video.author,
        "源链接": detail.source_url,
        "处理日期": datetime.now(UTC).date().isoformat(),
        "内容关键词": _infer_content_keywords(detail),
    }
    if video.duration > 0:
        values["时长"] = _format_duration(video.duration)

    lines = ["---"]
    for key, value in values.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            lines.extend(f"  - {_yaml_string(item)}" for item in value)
        elif isinstance(value, int):
            lines.append(f"{key}: {value}")
        else:
            lines.append(f"{key}: {_yaml_string(value)}")
    lines.append("---")
    return "\n".join(lines)


def _format_duration(duration_seconds: int) -> str:
    """秒数转 hh:mm:ss；不足一小时时输出 mm:ss。"""
    hours, remainder = divmod(max(duration_seconds, 0), 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    return f"{minutes:02d}:{seconds:02d}"


def _format_markdown_list(items: list[str]) -> str:
    if not items:
        return "- 暂无"

    return "\n".join(f"- {item}" for item in items if item.strip()) or "- 暂无"


def _format_content_structure(detail: ParseResponse) -> str:
    """返回动态深入区块 markdown；为空时不写入导出。"""
    return (detail.summary.structured_analysis_markdown or "").strip()


def _format_content_outline(detail: ParseResponse) -> str:
    return _format_markdown_list(detail.summary.content_outline) if detail.summary.content_outline else ""


def _format_methods(detail: ParseResponse) -> str:
    return _format_markdown_list(detail.summary.methods) if detail.summary.methods else ""


def _format_content_boundaries(
    detail: ParseResponse,
    include_full_text: bool,
) -> str:
    items = [
        item.strip()
        for item in detail.summary.content_boundaries
        if item.strip()
    ]
    source_type = (detail.video.text_source_type or "").strip().lower()
    if source_type in {"asr", "asr_transcript"}:
        items.append(
            "当前内容基于 AI 转写稿，ASR 可能存在识别误差，重要信息需结合原媒体复核。"
        )
    elif source_type == "shownotes":
        items.append("当前文本来自 shownotes / 内容简介，不代表完整音频逐字稿。")
    else:
        items.append("当前草稿只覆盖给定内容文本，不代表来源之外的信息。")
    items.append("外部作者观点只代表当前来源，不自动等于任何用户的观点。")
    if include_full_text:
        items.append(
            "完整原文仍保存在知录本地记录中，默认通用 Markdown 不附完整逐字稿。"
        )

    deduplicated_items = list(dict.fromkeys(items))
    return "\n".join(f"- {item}" for item in deduplicated_items)


def _format_highlights(
    highlights: list[SummaryHighlight],
) -> str:
    blocks = []
    for index, highlight in enumerate(highlights, start=1):
        blocks.append(
            "\n".join(
                [
                    f"### 整理 {index}",
                    highlight.text.strip(),
                    _format_highlight_reason(highlight),
                ]
            ).strip()
        )

    return "\n\n".join(blocks)


def _format_highlight_reason(highlight: SummaryHighlight) -> str:
    """
    摘录说明与应用场景分行输出；手动摘录不需要摘录说明。
    """
    if highlight.source == "manual" or not highlight.reason:
        return ""

    reason = highlight.reason.strip()
    parts = re.split(r"\s*可用场景：\s*", reason, maxsplit=1)
    lines = [f"- 摘录说明：{parts[0].strip()}"]
    if len(parts) == 2 and parts[1].strip():
        lines.append(f"- 应用场景：{parts[1].strip()}")
    return "\n".join(lines)


def _deduplicate_highlights(
    highlights: list[SummaryHighlight],
) -> list[SummaryHighlight]:
    deduplicated_highlights: list[SummaryHighlight] = []
    seen_texts: set[str] = set()
    for highlight in highlights:
        normalized_text = _normalize_highlight_text(highlight.text)
        if not normalized_text or normalized_text in seen_texts:
            continue
        seen_texts.add(normalized_text)
        deduplicated_highlights.append(highlight)
    return deduplicated_highlights


def _normalize_highlight_text(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _infer_content_type(detail: ParseResponse) -> str:
    summary_content_type = (detail.summary.content_type or "").strip()
    if summary_content_type in {"视频", "播客"}:
        return summary_content_type

    media_type = (detail.video.media_type or "video").strip().lower()
    return MEDIA_CONTENT_TYPE_LABELS.get(media_type, "视频")


def _infer_content_keywords(detail: ParseResponse) -> list[str]:
    summary = detail.summary
    values = (
        summary.content_keywords
        or summary.search_keywords
        or summary.topics
    )
    keywords = [
        value.strip()
        for value in values
        if value.strip() and value.strip().lower() not in {"video", "podcast", "media"}
    ]
    if keywords:
        return list(dict.fromkeys(keywords))[:8]

    fallback_keyword = detail.video.title.strip()[:40]
    return [fallback_keyword or "内容摘要"]


def _write_markdown_if_enabled(filename: str, markdown: str) -> Path | None:
    enable_write = os.getenv("OBSIDIAN_ENABLE_VAULT_WRITE", "0").strip() == "1"
    vault_dir = os.getenv("OBSIDIAN_VAULT_DIR", "").strip()
    if not enable_write or not vault_dir:
        return None

    vault_path = Path(vault_dir).expanduser().resolve()
    if not vault_path.exists() or not vault_path.is_dir():
        raise ObsidianExportError(
            "OBSIDIAN_VAULT_DIR_INVALID",
            "Obsidian vault 目录不存在或不是文件夹。",
        )

    export_subdir = os.getenv("OBSIDIAN_EXPORT_SUBDIR", DEFAULT_EXPORT_SUBDIR).strip()
    target_dir = _resolve_vault_subdir(vault_path, export_subdir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = _get_available_path(target_dir, filename)
    target_path.write_text(markdown, encoding="utf-8")
    return target_path


def _resolve_vault_subdir(vault_path: Path, export_subdir: str) -> Path:
    subdir = Path(export_subdir or DEFAULT_EXPORT_SUBDIR)
    if subdir.is_absolute():
        raise ObsidianExportError(
            "OBSIDIAN_EXPORT_SUBDIR_INVALID",
            "Obsidian 导出子目录必须是 vault 内部的相对路径。",
        )

    target_dir = (vault_path / subdir).resolve()
    try:
        target_dir.relative_to(vault_path)
    except ValueError as error:
        raise ObsidianExportError(
            "OBSIDIAN_EXPORT_SUBDIR_INVALID",
            "Obsidian 导出路径不能越过 vault 目录。",
        ) from error

    return target_dir


def _get_available_path(directory: Path, filename: str) -> Path:
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".md"
    candidate = directory / f"{stem}{suffix}"
    index = 2
    while candidate.exists():
        candidate = directory / f"{stem}-{index}{suffix}"
        index += 1

    return candidate


def _sanitize_filename(value: str) -> str:
    sanitized_value = re.sub(r'[\\/:*?"<>|]+', " ", value)
    sanitized_value = re.sub(r"\s+", "-", sanitized_value).strip("- ")
    return sanitized_value[:80] or "zhilu-media-note"


def _yaml_string(value: object) -> str:
    return json.dumps(str(value), ensure_ascii=False)
