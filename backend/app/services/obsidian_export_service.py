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
    confirmed_highlights = _deduplicate_highlights(
        detail.note_draft.highlights if detail.note_draft else []
    )
    candidate_highlights = _collect_candidate_highlights(
        confirmed_highlights,
        summary.highlights or [],
    )
    frontmatter = _build_frontmatter(detail)
    sections = [
        frontmatter,
        f"# {video.title}",
        "## 一句话摘要",
        summary.tldr,
        "## 内容结构",
        _format_content_structure(detail),
        "## 核心观点",
        _format_markdown_list(summary.key_points),
        "## 可靠原文摘录",
        _format_highlights(
            confirmed_highlights,
            callout_title="用户确认摘录",
            empty_text="- 暂无用户确认摘录。",
        ),
        "## 通用应用线索",
        _format_application_clues(detail),
        "## 内容边界与待核实信息",
        _format_content_boundaries(detail, include_full_text),
    ]
    if candidate_highlights:
        sections[sections.index("## 通用应用线索"):sections.index("## 通用应用线索")] = [
            "## AI 候选摘录（未确认）",
            "以下内容由 AI 从原文中提取，尚未经过用户确认。",
            _format_highlights(
                candidate_highlights,
                callout_title="AI 候选摘录",
                empty_text="",
            ),
        ]

    return "\n\n".join(section.strip() for section in sections if section.strip()) + "\n"


def _build_frontmatter(detail: ParseResponse) -> str:
    video = detail.video
    values: dict[str, object] = {
        "草稿版本": UNIVERSAL_KNOWLEDGE_DRAFT_VERSION,
        "标题": video.title,
        "内容类型": _infer_content_type(detail),
        "平台": video.platform,
        "原始作者": video.author,
        "源链接": detail.source_url,
        "处理日期": datetime.now(UTC).date().isoformat(),
        "内容关键词": _infer_content_keywords(detail),
    }
    if video.duration > 0:
        values["时长（秒）"] = video.duration

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


def _format_markdown_list(items: list[str]) -> str:
    if not items:
        return "- 暂无"

    return "\n".join(f"- {item}" for item in items if item.strip()) or "- 暂无"


def _format_content_structure(detail: ParseResponse) -> str:
    structured_analysis = detail.summary.structured_analysis_markdown.strip()
    return structured_analysis or _format_markdown_list(detail.summary.key_points)


def _format_application_clues(detail: ParseResponse) -> str:
    items = detail.summary.application_clues or detail.summary.takeaways
    return _format_markdown_list(items)


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
    callout_title: str,
    empty_text: str,
) -> str:
    if not highlights:
        return empty_text

    blocks = []
    for highlight in highlights:
        reason = f"\n- 摘录说明：{highlight.reason}" if highlight.reason else ""
        blocks.append(
            "\n".join(
                [
                    _format_quote_callout(highlight.text, callout_title),
                    reason,
                ]
            )
        )

    return "\n\n".join(blocks)


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


def _collect_candidate_highlights(
    confirmed_highlights: list[SummaryHighlight],
    candidate_highlights: list[SummaryHighlight],
) -> list[SummaryHighlight]:
    confirmed_texts = {
        _normalize_highlight_text(highlight.text)
        for highlight in confirmed_highlights
    }
    candidates: list[SummaryHighlight] = []
    seen_texts = set(confirmed_texts)
    for highlight in candidate_highlights:
        normalized_text = _normalize_highlight_text(highlight.text)
        if not normalized_text or normalized_text in seen_texts:
            continue
        seen_texts.add(normalized_text)
        candidates.append(highlight)
    return candidates


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


def _format_quote_callout(text: str, callout_title: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    quote_lines = lines or [""]
    quoted_text = "\n".join(f"> “{line}”" for line in quote_lines)
    return f"> [!quote] {callout_title}\n{quoted_text}"


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
