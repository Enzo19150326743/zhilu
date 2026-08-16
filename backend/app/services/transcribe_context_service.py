from app.schemas import (
    ShownotesContext,
    ShownotesSpeaker,
    TranscribeContextSettings,
    TranscribeSpeakerProfile,
)

PROGRAM_STRUCTURE_LABELS = {
    "auto": "自动判断",
    "solo": "单人口播",
    "interview": "双人访谈",
    "roundtable": "多人聊天 / 圆桌",
}

CONTENT_TAG_LABELS = {
    "ai_tech": "AI / 科技",
    "product_business": "产品 / 商业",
    "tutorial_method": "教程 / 方法",
    "opinion_observation": "观点 / 现象",
    "case_review": "案例 / 复盘",
    "career_startup": "职场 / 创业",
    "psychology_growth": "心理 / 成长",
    "life_story": "生活 / 故事",
    "casual_chat": "闲聊 / 泛谈",
}

MAX_CONTENT_TAGS = 12
MAX_SPEAKERS = 6
SYSTEM_SPEAKER_NAMES = {"主持人", "嘉宾", "嘉宾 A", "嘉宾 B", "嘉宾 C", "讲者"}


def merge_shownotes_context(
    user_settings: TranscribeContextSettings | None,
    extracted_context: ShownotesContext | None,
) -> TranscribeContextSettings:
    """
    合并用户设置和 shownotes 提取结果。

    用户明确填写的人名和非 auto 节目结构优先；系统占位标签允许被可靠的
    shownotes 人物替换。低置信度人物只保留角色标签，不把不确定姓名写入终稿。
    """
    user = user_settings or TranscribeContextSettings()
    extracted = extracted_context or ShownotesContext()
    program_structure = (
        user.program_structure
        if _normalize_key(user.program_structure) not in {"", "auto"}
        else extracted.program_structure or user.program_structure
    )
    if program_structure not in PROGRAM_STRUCTURE_LABELS:
        program_structure = "auto"

    user_speakers = _normalize_speakers(user.speakers)
    extracted_speakers = [
        speaker
        for speaker in extracted.speakers[:MAX_SPEAKERS]
        if _is_reliable_shownotes_speaker(speaker)
    ]
    merged_speakers: list[TranscribeSpeakerProfile] = []
    manual_roles: set[str] = set()

    for user_speaker in user_speakers:
        if _is_system_speaker_placeholder(user_speaker):
            replacement = _find_shownotes_speaker(
                extracted_speakers,
                role=user_speaker.role or user_speaker.name,
            )
            if replacement is not None:
                merged_speakers.append(_to_transcribe_speaker(replacement))
                continue
        else:
            role = _normalize_key(user_speaker.role)
            if role:
                manual_roles.add(role)
        merged_speakers.append(user_speaker)

    for extracted_speaker in extracted_speakers:
        role_key = _normalize_key(extracted_speaker.role)
        if role_key in manual_roles:
            continue
        profile = _to_transcribe_speaker(extracted_speaker)
        if any(
            _normalize_key(existing.name) == _normalize_key(profile.name)
            for existing in merged_speakers
        ):
            continue
        if len(merged_speakers) >= MAX_SPEAKERS:
            break
        merged_speakers.append(profile)

    return TranscribeContextSettings(
        program_structure=program_structure,
        content_tags=list(user.content_tags),
        speakers=merged_speakers[:MAX_SPEAKERS],
        correction_terms=_merge_terms(user.correction_terms, extracted.terms),
    )


def normalize_transcribe_context_settings(
    settings: TranscribeContextSettings | None,
    *,
    platform: str | None,
    media_type: str | None,
) -> TranscribeContextSettings:
    """
    规范化用户提供的转写上下文；异常或空值只降级，不阻断 ASR 主链路。
    """
    platform_key = _normalize_key(platform)
    media_type_key = _normalize_key(media_type)
    default_structure = _get_default_program_structure(platform_key)
    raw_settings = settings or TranscribeContextSettings(
        program_structure=default_structure
    )
    program_structure = _normalize_program_structure(
        raw_settings.program_structure,
        default_structure,
    )
    content_tags = _normalize_content_tags(raw_settings.content_tags)
    speakers = _normalize_speakers(raw_settings.speakers)
    correction_terms = _normalize_correction_terms(raw_settings.correction_terms)
    if not speakers:
        speakers = _build_default_speakers(program_structure)

    return TranscribeContextSettings(
        program_structure=program_structure,
        content_tags=content_tags,
        speakers=speakers,
        correction_terms=correction_terms,
    )


def build_whisper_context_lines(settings: TranscribeContextSettings) -> list[str]:
    """生成给 Whisper initial_prompt 的短上下文，避免 prompt 过长。"""
    lines = [
        f"节目结构：{PROGRAM_STRUCTURE_LABELS.get(settings.program_structure, '自动判断')}"
    ]
    tag_labels = _get_content_tag_labels(settings.content_tags)
    if tag_labels:
        lines.append(f"内容标签：{'、'.join(tag_labels)}")

    speaker_terms = [
        _format_speaker_compact(speaker)
        for speaker in settings.speakers[:MAX_SPEAKERS]
        if _has_speaker_content(speaker)
    ]
    if speaker_terms:
        lines.append(f"说话人参考：{'；'.join(speaker_terms)}")

    return lines


def build_correction_context_lines(settings: TranscribeContextSettings) -> list[str]:
    """生成给 DeepSeek 校对的详细上下文和边界说明。"""
    lines = [
        f"节目结构：{PROGRAM_STRUCTURE_LABELS.get(settings.program_structure, '自动判断')}",
    ]
    tag_labels = _get_content_tag_labels(settings.content_tags)
    lines.append(f"内容标签：{'、'.join(tag_labels) if tag_labels else '自动判断'}")
    if settings.program_structure == "auto" and not tag_labels and not settings.speakers:
        lines.append("平台语境：如为播客或长音频，请优先保持自然段和对话可读性。")

    if settings.speakers:
        lines.append("说话人辅助信息：")
        for speaker in settings.speakers[:MAX_SPEAKERS]:
            lines.append(f"- {_format_speaker_detail(speaker)}")
    else:
        lines.append("说话人辅助信息：未提供。")

    lines.extend(
        [
            "说话人标签只是文本推断辅助，不代表真实声纹或音色识别。",
            "不确定是谁说的，speaker 返回 null 或“未区分”，不要强行标注。",
            "内容标签可以交叉，不是唯一分类。",
        ]
    )
    return lines


def build_speaker_hotwords(settings: TranscribeContextSettings) -> list[str]:
    """把用户提供的说话人名称和身份加入 Whisper hotwords。"""
    hotwords: list[str] = []
    seen_values: set[str] = set()
    for speaker in settings.speakers[:MAX_SPEAKERS]:
        for value in (speaker.name, speaker.role):
            text = _normalize_text(value)
            if not text or text.casefold() in seen_values:
                continue

            seen_values.add(text.casefold())
            hotwords.append(text)

    return hotwords


def get_allowed_speaker_labels(settings: TranscribeContextSettings) -> set[str]:
    """返回 DeepSeek speaker 字段允许使用的标签。"""
    labels = {"未区分"}
    for speaker in settings.speakers[:MAX_SPEAKERS]:
        for value in (speaker.name, speaker.role):
            text = _normalize_text(value)
            if text:
                labels.add(text)

    if settings.program_structure in {"interview", "roundtable"}:
        labels.update({"说话人 1", "说话人 2", "说话人 3"})

    return labels


def get_speaker_label_status(
    settings: TranscribeContextSettings,
    *,
    has_labeled_segments: bool,
    has_unlabeled_segments: bool,
    failed: bool = False,
) -> str:
    """根据校对结果生成 asr_meta 中的 speaker 标签状态。"""
    if failed:
        return "failed"
    if not settings.speakers or settings.program_structure == "solo":
        return "disabled"
    if has_labeled_segments and has_unlabeled_segments:
        return "partial"
    if has_labeled_segments:
        return "inferred"

    return "disabled"


def _get_default_program_structure(platform_key: str) -> str:
    if platform_key in {"douyin", "抖音"}:
        return "solo"

    return "auto"


def _normalize_program_structure(raw_value: str | None, default_value: str) -> str:
    normalized_value = _normalize_key(raw_value)
    if normalized_value in PROGRAM_STRUCTURE_LABELS:
        return normalized_value

    return default_value if default_value in PROGRAM_STRUCTURE_LABELS else "auto"


def _normalize_content_tags(raw_tags: list[str]) -> list[str]:
    tags: list[str] = []
    seen_tags: set[str] = set()
    for raw_tag in raw_tags[:MAX_CONTENT_TAGS]:
        tag = _normalize_key(raw_tag)
        if tag not in CONTENT_TAG_LABELS or tag in seen_tags:
            continue

        seen_tags.add(tag)
        tags.append(tag)

    return tags


def _normalize_speakers(
    raw_speakers: list[TranscribeSpeakerProfile],
) -> list[TranscribeSpeakerProfile]:
    speakers: list[TranscribeSpeakerProfile] = []
    for raw_speaker in raw_speakers[:MAX_SPEAKERS]:
        speaker = TranscribeSpeakerProfile(
            name=_normalize_text(raw_speaker.name),
            role=_normalize_text(raw_speaker.role),
            description=_normalize_text(raw_speaker.description),
        )
        if not _has_speaker_content(speaker):
            continue

        speakers.append(speaker)

    return speakers


def _normalize_correction_terms(raw_terms: list[str]) -> list[str]:
    terms: list[str] = []
    seen_terms: set[str] = set()
    for raw_term in raw_terms[:120]:
        term = _normalize_text(raw_term)
        if not term:
            continue

        normalized_key = term.casefold()
        if normalized_key in seen_terms:
            continue

        seen_terms.add(normalized_key)
        terms.append(term)

    return terms


def _build_default_speakers(program_structure: str) -> list[TranscribeSpeakerProfile]:
    if program_structure == "solo":
        return [TranscribeSpeakerProfile(name="讲者", role="讲者")]
    if program_structure == "interview":
        return [
            TranscribeSpeakerProfile(name="主持人", role="主持人"),
            TranscribeSpeakerProfile(name="嘉宾", role="嘉宾"),
        ]
    if program_structure == "roundtable":
        return [
            TranscribeSpeakerProfile(name="主持人", role="主持人"),
            TranscribeSpeakerProfile(name="嘉宾 A", role="嘉宾"),
            TranscribeSpeakerProfile(name="嘉宾 B", role="嘉宾"),
        ]

    return []


def _get_content_tag_labels(content_tags: list[str]) -> list[str]:
    return [
        CONTENT_TAG_LABELS[tag]
        for tag in content_tags[:MAX_CONTENT_TAGS]
        if tag in CONTENT_TAG_LABELS
    ]


def _format_speaker_compact(speaker: TranscribeSpeakerProfile) -> str:
    name = _normalize_text(speaker.name)
    role = _normalize_text(speaker.role)
    if name and role and name != role:
        return f"{name}（{role}）"
    if name:
        return name

    return role or "未命名说话人"


def _format_speaker_detail(speaker: TranscribeSpeakerProfile) -> str:
    parts = [_format_speaker_compact(speaker)]
    description = _normalize_text(speaker.description)
    if description:
        parts.append(description)

    return "：".join(parts)


def _has_speaker_content(speaker: TranscribeSpeakerProfile) -> bool:
    return any(
        _normalize_text(value)
        for value in (speaker.name, speaker.role, speaker.description)
    )


def _normalize_text(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None

    normalized_value = " ".join(value.strip().split())
    return normalized_value or None


def _normalize_key(value: str | None) -> str:
    if not isinstance(value, str):
        return ""

    return value.strip().lower()


def _is_system_speaker_placeholder(speaker: TranscribeSpeakerProfile) -> bool:
    name = _normalize_text(speaker.name)
    role = _normalize_text(speaker.role)
    return bool(
        (name and name in SYSTEM_SPEAKER_NAMES)
        or (not name and role and role in SYSTEM_SPEAKER_NAMES)
    )


def _is_reliable_shownotes_speaker(speaker: ShownotesSpeaker) -> bool:
    return speaker.confidence in {"high", "medium"} or bool(
        _normalize_text(speaker.role)
        and _normalize_text(speaker.role) not in {"未区分", "unknown"}
    )


def _find_shownotes_speaker(
    speakers: list[ShownotesSpeaker],
    *,
    role: str,
) -> ShownotesSpeaker | None:
    role_key = _normalize_key(role)
    for speaker in speakers:
        if _normalize_key(speaker.role) == role_key:
            return speaker
    return speakers[0] if speakers and role_key in {"主持人", "嘉宾", "讲者"} else None


def _to_transcribe_speaker(speaker: ShownotesSpeaker) -> TranscribeSpeakerProfile:
    if speaker.confidence == "low":
        role = _normalize_text(speaker.role) or "未区分"
        return TranscribeSpeakerProfile(name=role, role=role)
    return TranscribeSpeakerProfile(
        name=_normalize_text(speaker.name),
        role=_normalize_text(speaker.role),
        description=_normalize_text(speaker.description),
    )


def _merge_terms(user_terms: list[str], extracted_terms: list[str]) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for raw_term in [*user_terms, *extracted_terms]:
        term = _normalize_text(raw_term)
        if not term or term.casefold() in seen:
            continue
        seen.add(term.casefold())
        terms.append(term)
    return terms[:120]
