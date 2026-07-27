from dataclasses import dataclass

from app.schemas import TranscriptSegment


DEFAULT_SENTENCE_ENDINGS = ("。", "！", "？", "!", "?", "；", ";")
CLOSING_PUNCTUATION = "”’\"'）】》」』"


@dataclass(frozen=True)
class SegmentNormalizationConfig:
    """把模型碎片整理为适合校对和阅读的连续片段。"""

    max_seconds: float
    max_characters: int
    silence_gap_seconds: float
    min_sentence_seconds: float = 0
    sentence_endings: tuple[str, ...] = DEFAULT_SENTENCE_ENDINGS


def normalize_adjacent_segments(
    segments: list[TranscriptSegment],
    *,
    config: SegmentNormalizationConfig,
) -> list[TranscriptSegment]:
    """
    只合并相邻片段，不改变文本顺序。

    NOTE: 该层处理的是 ASR 输出粒度，不重新切音频，也不猜测模型没有提供的词级时间戳。
    """
    normalized_segments: list[TranscriptSegment] = []
    pending_segments: list[TranscriptSegment] = []

    def flush_pending() -> None:
        if not pending_segments:
            return

        normalized_segments.append(
            TranscriptSegment(
                start=pending_segments[0].start,
                end=max(segment.end for segment in pending_segments),
                text=" ".join(segment.text.strip() for segment in pending_segments),
                speaker=pending_segments[0].speaker,
            )
        )
        pending_segments.clear()

    for segment in segments:
        normalized_text = segment.text.strip()
        if not normalized_text:
            continue

        current_segment = segment.model_copy(update={"text": normalized_text})
        if pending_segments and _requires_boundary_before(
            pending_segments[-1],
            current_segment,
            silence_gap_seconds=config.silence_gap_seconds,
        ):
            flush_pending()

        pending_segments.append(current_segment)
        combined_text = " ".join(item.text for item in pending_segments)
        combined_seconds = max(item.end for item in pending_segments) - min(
            item.start for item in pending_segments
        )
        if (
            (
                _ends_sentence(combined_text, config.sentence_endings)
                and combined_seconds >= config.min_sentence_seconds
            )
            or combined_seconds >= config.max_seconds
            or len(combined_text) >= config.max_characters
        ):
            flush_pending()

    flush_pending()
    return normalized_segments


def _requires_boundary_before(
    previous_segment: TranscriptSegment,
    current_segment: TranscriptSegment,
    *,
    silence_gap_seconds: float,
) -> bool:
    previous_speaker = (previous_segment.speaker or "").strip()
    current_speaker = (current_segment.speaker or "").strip()
    if previous_speaker != current_speaker and (previous_speaker or current_speaker):
        return True

    return current_segment.start - previous_segment.end >= silence_gap_seconds


def _ends_sentence(text: str, sentence_endings: tuple[str, ...]) -> bool:
    sentence_tail = text.rstrip().rstrip(CLOSING_PUNCTUATION)
    return sentence_tail.endswith(sentence_endings)
