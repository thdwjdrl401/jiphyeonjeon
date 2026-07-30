from __future__ import annotations

import re
import unicodedata

from app.lecture_notes.models import (
    LectureNote,
    LectureNoteModelResult,
    LectureNoteTopic,
    TopicAction,
)

_EXTERNAL_URL = re.compile(r"https?://", re.IGNORECASE)


def apply_model_result(
    note: LectureNote,
    result: LectureNoteModelResult,
) -> LectureNote:
    """구조화 모델 결과 하나를 기존 노트에 순수 함수로 반영한다."""
    points = _unique_points(result.keyPoints)
    if not note.topics or result.topicAction is TopicAction.START_NEW:
        topic = LectureNoteTopic(
            topic_id=f"topic-{len(note.topics) + 1}",
            title=result.topicTitle,
            key_points=points,
        )
        topics = (*note.topics, topic)
    else:
        current = note.topics[-1]
        topic = LectureNoteTopic(
            topic_id=current.topic_id,
            title=current.title,
            key_points=_unique_points((*current.key_points, *points)),
        )
        topics = (*note.topics[:-1], topic)
    return LectureNote(topics=topics, note_version=note.note_version + 1)


def render_markdown(note: LectureNote) -> str:
    sections: list[str] = []
    for topic in note.topics:
        lines = [f"## {_safe_inline_markdown(topic.title)}", ""]
        lines.extend(f"- {_safe_inline_markdown(point)}" for point in topic.key_points)
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def _unique_points(points: tuple[str, ...]) -> tuple[str, ...]:
    unique: list[str] = []
    seen: set[str] = set()
    for point in points:
        normalized = unicodedata.normalize("NFC", point.strip())
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return tuple(unique)


def _safe_inline_markdown(value: str) -> str:
    # 구조는 애플리케이션이 만들고 모델 text에는 bold와 inline code만 남긴다.
    escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace("[", r"\[").replace("]", r"\]")
    return _EXTERNAL_URL.sub(lambda match: match.group(0).replace(":", "&#58;"), escaped)
