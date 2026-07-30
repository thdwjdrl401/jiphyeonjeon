from __future__ import annotations

import re
import unicodedata

from app.lecture_notes.models import (
    LectureNote,
    LectureNoteDecisionAction,
    LectureNoteModelResult,
    LectureNoteTopic,
    TopicAction,
)

_EXTERNAL_URL = re.compile(r"https?://", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")
_TRAILING_SENTENCE_MARKS = re.compile(r"[.!?。？！]+$")


def apply_model_result(
    note: LectureNote,
    result: LectureNoteModelResult,
) -> LectureNote:
    """구조화 모델 결과 하나를 기존 노트에 순수 함수로 반영한다."""
    if result.action is LectureNoteDecisionAction.IGNORE:
        return note
    if result.topicTitle is None:  # pragma: no cover - model validation이 보장한다
        raise ValueError("non-IGNORE result requires a topic title")
    points = _unique_points(result.keyPoints)
    if not note.topics or result.action is LectureNoteDecisionAction.START_NEW:
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
    if topics == note.topics:
        return note
    return LectureNote(topics=topics, chunk_sequence=note.chunk_sequence + 1)


def render_markdown(note: LectureNote) -> str:
    sections: list[str] = []
    for topic in note.topics:
        lines = [f"## {_safe_inline_markdown(topic.title)}", ""]
        lines.extend(f"- {_safe_inline_markdown(point)}" for point in topic.key_points)
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def render_markdown_fragment(
    topic_title: str,
    key_points: tuple[str, ...],
    topic_action: TopicAction,
) -> str:
    """새로 추가된 요점만 기존 Markdown 뒤에 붙일 수 있는 조각으로 만든다."""
    lines: list[str] = []
    if topic_action is TopicAction.START_NEW:
        lines.extend((f"## {_safe_inline_markdown(topic_title)}", ""))
    lines.extend(f"- {_safe_inline_markdown(point)}" for point in key_points)
    return "\n".join(lines)


def _unique_points(points: tuple[str, ...]) -> tuple[str, ...]:
    unique: list[str] = []
    seen: set[str] = set()
    for point in points:
        normalized = _WHITESPACE.sub(" ", unicodedata.normalize("NFC", point).strip())
        key = _TRAILING_SENTENCE_MARKS.sub("", normalized).rstrip().casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(normalized)
    return tuple(unique)


def _safe_inline_markdown(value: str) -> str:
    # 구조는 애플리케이션이 만들고 모델 text에는 bold와 inline code만 남긴다.
    escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace("[", r"\[").replace("]", r"\]")
    return _EXTERNAL_URL.sub(lambda match: match.group(0).replace(":", "&#58;"), escaped)
