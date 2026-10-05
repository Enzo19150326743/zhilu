"""为转写稿和片段生成稳定身份，供总结证据关联使用。"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.schemas import TranscriptSegment


@dataclass(frozen=True)
class EvidenceSegment:
    """模型可引用、后端可校验的原文片段。"""

    id: str
    index: int
    segment: TranscriptSegment


def normalize_transcript_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def build_transcript_fingerprint(
    plain_text: str,
    segments: list[TranscriptSegment],
) -> str:
    """指纹绑定当前有效稿；文本或片段变化都会生成新身份。"""
    segment_payload = "\n".join(
        "|".join(
            (
                f"{segment.start:.3f}",
                f"{segment.end:.3f}",
                normalize_transcript_text(segment.speaker or ""),
                normalize_transcript_text(segment.text),
            )
        )
        for segment in segments
        if segment.text.strip()
    )
    payload = f"{normalize_transcript_text(plain_text)}\n--segments--\n{segment_payload}"
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def build_evidence_segments(
    segments: list[TranscriptSegment],
) -> list[EvidenceSegment]:
    result: list[EvidenceSegment] = []
    for index, segment in enumerate(segments):
        normalized_text = normalize_transcript_text(segment.text)
        if not normalized_text:
            continue
        identity_payload = "|".join(
            (
                str(index),
                f"{segment.start:.3f}",
                f"{segment.end:.3f}",
                normalize_transcript_text(segment.speaker or ""),
                normalized_text,
            )
        )
        digest = hashlib.sha256(identity_payload.encode("utf-8")).hexdigest()[:10]
        result.append(
            EvidenceSegment(
                id=f"seg-{index + 1:04d}-{digest}",
                index=index,
                segment=segment,
            )
        )
    return result
