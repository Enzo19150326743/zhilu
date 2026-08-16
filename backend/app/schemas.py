from typing import Literal

from pydantic import BaseModel, Field, field_validator


MAX_SUMMARY_VIDEO_TITLE_LENGTH = 300
MAX_CORRECTION_TERMS = 120
MAX_CORRECTION_TERM_LENGTH = 80


class HealthResponse(BaseModel):
    """本地健康检查响应。"""

    status: str
    mode: str
    version: str


class RateLimitItem(BaseModel):
    """单个本地动作的频控状态。"""

    action: str
    limit: int
    used: int
    remaining: int
    reset_at: str


class RateLimitStatusResponse(BaseModel):
    """本地频控状态响应。"""

    success: bool = True
    items: list[RateLimitItem]


class BilibiliAuthStatusResponse(BaseModel):
    """B 站本地 Cookie 登录态诊断响应。"""

    success: bool = True
    cookie_options_enabled: bool
    cookie_file_configured: bool
    cookie_loaded: bool
    cookie_source: str | None = None
    is_login: bool = False
    mid: int | None = None
    username: str | None = None
    is_vip: bool | None = None
    message: str


class ApiError(BaseModel):
    """统一错误响应，避免把内部异常直接暴露给前端。"""

    success: bool = False
    error_code: str
    message: str


class ParseRequest(BaseModel):
    """媒体解析请求。"""

    url: str = Field(min_length=1, max_length=2048)


class TranscriptSegment(BaseModel):
    """带时间戳的字幕片段。"""

    start: float
    end: float
    text: str
    speaker: str | None = None


class TranscribeSpeakerProfile(BaseModel):
    """转写前用户提供的说话人辅助信息。"""

    name: str | None = Field(default=None, max_length=80)
    role: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=300)


class ShownotesSpeaker(BaseModel):
    """从 shownotes 提取的说话人信息。"""

    name: str = Field(min_length=1, max_length=80)
    role: str = Field(default="未区分", max_length=80)
    description: str | None = Field(default=None, max_length=300)
    confidence: Literal["high", "medium", "low"] = "medium"


class ShownotesContext(BaseModel):
    """一次 shownotes AI 提取结果，供校对和总结复用。"""

    program_structure: str = Field(default="auto", max_length=40)
    speakers: list[ShownotesSpeaker] = Field(default_factory=list, max_length=6)
    terms: list[str] = Field(default_factory=list, max_length=120)
    content_outline: list[str] = Field(default_factory=list, max_length=12)


class TranscribeContextSettings(BaseModel):
    """转写上下文设置，用于改善校对和访谈稿整理。"""

    program_structure: str = Field(default="auto", max_length=40)
    content_tags: list[str] = Field(default_factory=list, max_length=12)
    speakers: list[TranscribeSpeakerProfile] = Field(default_factory=list, max_length=6)
    correction_terms: list[str] = Field(
        default_factory=list,
        max_length=MAX_CORRECTION_TERMS,
    )

    @field_validator("correction_terms", mode="before")
    @classmethod
    def normalize_correction_terms(cls, value: object) -> object:
        if not isinstance(value, list):
            return value

        terms: list[str] = []
        seen_terms: set[str] = set()
        for raw_term in value:
            if not isinstance(raw_term, str):
                continue

            term = " ".join(raw_term.strip().split())
            if not term:
                continue
            if len(term) > MAX_CORRECTION_TERM_LENGTH:
                raise ValueError(
                    f"单个 AI 校对术语不能超过 {MAX_CORRECTION_TERM_LENGTH} 个字符"
                )

            normalized_key = term.casefold()
            if normalized_key in seen_terms:
                continue

            seen_terms.add(normalized_key)
            terms.append(term)

        return terms


class TranscriptAsrMeta(BaseModel):
    """本地 ASR 转写元信息。"""

    engine: str = "faster-whisper"
    model: str
    device: str
    compute_type: str
    language: str | None = None
    correction_status: str
    correction_model: str | None = None
    glossary_term_count: int = 0
    correction_term_count: int = 0
    correction_terms: list[str] = Field(default_factory=list)
    program_structure: str | None = None
    content_tags: list[str] = Field(default_factory=list)
    speaker_profiles: list[TranscribeSpeakerProfile] = Field(default_factory=list)
    speaker_label_status: str | None = None
    provider: str | None = None
    chunk_count: int | None = None
    timestamp_source: str | None = None
    audio_download_seconds: float | None = None
    transcription_seconds: float | None = None
    correction_seconds: float | None = None
    total_seconds: float | None = None


class TranscriptPayload(BaseModel):
    """内容文本数据。"""

    segments: list[TranscriptSegment]
    plain_text: str
    raw_segments: list[TranscriptSegment] | None = None
    raw_plain_text: str | None = None
    asr_meta: TranscriptAsrMeta | None = None


class SummarizeRequest(BaseModel):
    """媒体内容总结请求。"""

    transcript_plain_text: str = Field(min_length=1, max_length=120000)
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    source_url: str | None = Field(default=None, max_length=2048)
    video_title: str | None = Field(
        default=None,
        max_length=MAX_SUMMARY_VIDEO_TITLE_LENGTH,
    )
    video_author: str | None = Field(default=None, max_length=200)
    media_type: str | None = Field(default=None, max_length=40)
    text_source_type: str | None = Field(default=None, max_length=40)
    shownotes_plain_text: str | None = Field(default=None, max_length=120000)
    shownotes_context: ShownotesContext | None = None

    @field_validator("video_title", mode="before")
    @classmethod
    def normalize_video_title(cls, value: object) -> object:
        """
        平台可能把整段发布文案作为标题；标题只是总结上下文，不能阻断正文处理。
        """
        if not isinstance(value, str):
            return value

        normalized_title = value.strip()
        if not normalized_title:
            return None

        return normalized_title[:MAX_SUMMARY_VIDEO_TITLE_LENGTH]


class DownloadRequest(BaseModel):
    """视频下载请求。"""

    url: str = Field(min_length=1, max_length=2048)
    format_id: str = Field(min_length=1, max_length=160)
    merge_with_audio: bool = False


class TranscribeRequest(BaseModel):
    """ASR 转写请求；旧客户端不传引擎时继续使用本地 Whisper。"""

    url: str = Field(min_length=1, max_length=2048)
    video_id: str | None = Field(default=None, max_length=200)
    context_settings: TranscribeContextSettings | None = None
    asr_engine: Literal[
        "local_whisper",
        "sensevoice_small",
    ] = "local_whisper"


class AsrStatusResponse(BaseModel):
    """前端选择转写引擎时需要的非敏感能力状态。"""

    success: bool = True
    recommended_engine: Literal["local_whisper", "sensevoice_small"] = (
        "local_whisper"
    )
    whisper_model: str = "large-v3-turbo"
    sensevoice_available: bool = False
    sensevoice_model: str = "iic/SenseVoiceSmall"
    sensevoice_message: str | None = None
    correction_available: bool = False
    correction_message: str | None = None


class CorrectionTermFolder(BaseModel):
    """用户自建的 AI 校对术语文件夹。"""

    id: int
    name: str
    created_at: str
    updated_at: str


class CorrectionTermItem(BaseModel):
    """一条可复用的 AI 校对术语。"""

    id: int
    text: str
    folder_id: int | None = None
    usage_count: int = 0
    last_used_at: str | None = None
    created_at: str
    updated_at: str


class CorrectionTermLibraryResponse(BaseModel):
    """术语库完整快照，由前端生成最近和常用智能视图。"""

    success: bool = True
    folders: list[CorrectionTermFolder]
    terms: list[CorrectionTermItem]


class CorrectionTermFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class CorrectionTermBulkCreateRequest(BaseModel):
    terms: list[str] = Field(min_length=1, max_length=MAX_CORRECTION_TERMS)
    folder_id: int | None = None


class CorrectionTermRenameRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CORRECTION_TERM_LENGTH)


class CorrectionTermBatchMoveRequest(BaseModel):
    term_ids: list[int] = Field(min_length=1, max_length=MAX_CORRECTION_TERMS)
    folder_id: int | None = None


class CorrectionTermBatchDeleteRequest(BaseModel):
    term_ids: list[int] = Field(min_length=1, max_length=MAX_CORRECTION_TERMS)


class CorrectionTermMutationResponse(BaseModel):
    success: bool = True
    message: str


class DemoItem(BaseModel):
    """Demo 列表项。"""

    demo_id: str
    title: str
    description: str
    thumbnail: str


class DemoListResponse(BaseModel):
    """Demo 列表响应。"""

    success: bool = True
    demos: list[DemoItem]


class VideoInfo(BaseModel):
    """媒体元数据。"""

    video_id: str
    platform: str
    url: str
    title: str
    author: str
    duration: int
    thumbnail: str
    has_transcript: bool
    media_type: str | None = None
    text_source_type: str | None = None


class VideoFormat(BaseModel):
    """可用格式信息。"""

    format_id: str
    ext: str
    resolution: str
    vcodec: str
    acodec: str
    filesize: int | None
    label: str


class FormatDiagnostics(BaseModel):
    """媒体格式解析诊断信息。"""

    raw_format_count: int = 0
    max_height: int | None = None
    has_cookie_config: bool = False
    is_bilibili: bool = False


class TimelineItem(BaseModel):
    """摘要时间轴条目。"""

    time: str
    content: str


class SummaryHighlight(BaseModel):
    """可加入知识稿的摘录。"""

    id: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=5000)
    start: float | None = None
    end: float | None = None
    reason: str | None = Field(default=None, max_length=1000)
    tags: list[str] = Field(default_factory=list)
    source: str = Field(default="ai", max_length=40)
    source_type: str | None = Field(default=None, max_length=40)
    created_at: str | None = Field(default=None, max_length=80)


class NoteDraft(BaseModel):
    """当前媒体的摘录草稿。"""

    highlights: list[SummaryHighlight] = Field(default_factory=list)
    updated_at: str | None = Field(default=None, max_length=80)


class NoteDraftUpdateRequest(BaseModel):
    """保存摘录草稿请求。"""

    source_url: str = Field(min_length=1, max_length=2048)
    highlights: list[SummaryHighlight] = Field(default_factory=list)


class NoteDraftUpdateResponse(BaseModel):
    """保存摘录草稿响应。"""

    success: bool = True
    note_draft: NoteDraft


class ObsidianNoteExportRequest(BaseModel):
    """Obsidian Markdown 导出请求。"""

    source_url: str = Field(min_length=1, max_length=2048)
    include_full_text: bool = False


class ObsidianNoteExportResponse(BaseModel):
    """Obsidian Markdown 导出响应。"""

    success: bool = True
    filename: str
    written_to_vault: bool
    file_path: str | None = None
    markdown: str
    message: str


class QaRequest(BaseModel):
    """媒体内容问答请求。"""

    question: str = Field(min_length=1, max_length=800)
    transcript_plain_text: str = Field(min_length=1, max_length=120000)
    source_url: str | None = Field(default=None, max_length=2048)
    video_title: str | None = Field(default=None, max_length=300)
    video_author: str | None = Field(default=None, max_length=200)
    media_type: str | None = Field(default=None, max_length=40)
    text_source_type: str | None = Field(default=None, max_length=40)
    mode: str | None = Field(default="fast", max_length=40)
    summary_tldr: str | None = Field(default=None, max_length=1000)
    timeline: list[TimelineItem] = Field(default_factory=list)


class SummaryDetailSection(BaseModel):
    """按内容证据动态出现的深入解读区块。"""

    title: str = Field(min_length=1, max_length=80)
    markdown: str = Field(min_length=1, max_length=12000)


class VideoSummary(BaseModel):
    """AI 结构化总结。"""

    draft_version: str = Field(default="legacy", max_length=40)
    content_type: str | None = Field(default=None, max_length=40)
    topics: list[str] = Field(default_factory=list)
    tldr: str
    key_points: list[str]
    timeline: list[TimelineItem]
    structured_analysis_markdown: str
    takeaways: list[str]
    highlights: list[SummaryHighlight] = Field(default_factory=list)
    content_keywords: list[str] = Field(default_factory=list)
    application_clues: list[str] = Field(default_factory=list)
    content_boundaries: list[str] = Field(default_factory=list)
    # NOTE: 1.1 起由内容文本决定展示结构；旧字段继续保留，保证历史档案可读取。
    summary_profile: str = Field(default="generic", max_length=40)
    key_points_title: str = Field(default="内容要点", max_length=80)
    content_outline: list[str] = Field(default_factory=list)
    method_title: str | None = Field(default=None, max_length=80)
    methods: list[str] = Field(default_factory=list)
    deep_dive_sections: list[SummaryDetailSection] = Field(default_factory=list)
    # NOTE: 以下字段只用于兼容旧数字分身草稿记录，新版通用总结不再生成或消费。
    reason_for_saving: str | None = Field(default=None, max_length=1200)
    personal_relevance: list[str] = Field(default_factory=list)
    transformation_ideas: list[str] = Field(default_factory=list)
    search_keywords: list[str] = Field(default_factory=list)
    related_wikilinks: list[str] = Field(default_factory=list)
    to_confirm: list[str] = Field(default_factory=list)


class MindmapMeta(BaseModel):
    """智能导图渲染元数据。"""

    layout: str = "tree"
    content_category: str = "general"
    template_id: str = "general_tree"
    media_type: str | None = None
    text_source_type: str | None = None


class DemoDetailResponse(BaseModel):
    """完整 Demo 响应。"""

    success: bool = True
    video: VideoInfo
    formats: list[VideoFormat]
    format_diagnostics: FormatDiagnostics | None = None
    transcript: TranscriptPayload
    transcript_variants: dict[str, TranscriptPayload] = Field(default_factory=dict)
    active_transcript_variant: str | None = None
    summary: VideoSummary
    mindmap_markdown: str
    mindmap_meta: MindmapMeta | None = None
    note_draft: NoteDraft | None = None
    transcription_source_url: str | None = None


class ParseResponse(DemoDetailResponse):
    """真实解析骨架响应。"""

    source_url: str
    is_placeholder: bool = True
    is_from_cache: bool = False
    library_summary_status: str | None = None
    library_summary_model: str | None = None
    shownotes_plain_text: str | None = Field(default=None, max_length=120000)
    shownotes_context: ShownotesContext | None = None


class SummarizeResponse(BaseModel):
    """媒体内容总结响应。"""

    success: bool = True
    summary: VideoSummary
    mindmap_markdown: str
    mindmap_meta: MindmapMeta | None = None
    is_ai_generated: bool
    model: str
    fallback_reason: str | None = None


class QaReference(BaseModel):
    """媒体问答引用片段。"""

    time: str | None = None
    text: str


class QaResponse(BaseModel):
    """媒体内容问答响应。"""

    success: bool = True
    answer: str
    references: list[QaReference]
    is_ai_generated: bool
    model: str


class DownloadResponse(BaseModel):
    """本地下载完成响应。"""

    success: bool = True
    filename: str
    file_path: str
    format_selector: str
    message: str


class TranscribeResponse(BaseModel):
    """本地 ASR 转写响应。"""

    success: bool = True
    source_url: str
    video_id: str | None = None
    transcript: TranscriptPayload
    transcript_variant_key: str = "local_whisper"
    shownotes_context: ShownotesContext | None = None
    message: str


class LibraryItem(BaseModel):
    """本地内容库列表项。"""

    video_id: str
    source_url: str
    title: str
    author: str
    platform: str
    thumbnail: str
    duration: int
    has_transcript: bool
    summary_status: str
    summary_model: str | None
    media_type: str | None = None
    text_source_type: str | None = None
    updated_at: str


class LibraryListResponse(BaseModel):
    """本地内容库最近记录响应。"""

    success: bool = True
    items: list[LibraryItem]


class LibraryStatsResponse(BaseModel):
    """本地内容库统计响应。"""

    success: bool = True
    total_items: int
    with_transcript_count: int
    no_transcript_count: int
    summarized_count: int
    ai_summary_count: int
    fallback_summary_count: int
    ready_count: int
    needs_transcript_count: int


class LibraryDeleteResponse(BaseModel):
    """本地内容库删除响应。"""

    success: bool = True
    deleted_video_id: str


class LibraryClearResponse(BaseModel):
    """本地内容库清空响应。"""

    success: bool = True
    deleted_count: int
