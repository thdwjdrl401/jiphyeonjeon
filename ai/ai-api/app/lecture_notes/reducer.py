from __future__ import annotations

import re
import unicodedata

from app.lecture_notes.models import (
    LectureNote,
    LectureNoteDecisionAction,
    LectureNoteDraft,
    LectureNoteDraftItem,
    LectureNoteDraftItemType,
    LectureNoteDraftTopic,
    LectureNoteDraftTopicContent,
    LectureNoteDraftUpdateAction,
    LectureNoteDraftUpdateResult,
    LectureNoteModelResult,
    LectureNoteRefinedTopic,
    LectureNoteTopic,
    LectureNoteTopicStatus,
    TopicAction,
)

_EXTERNAL_URL = re.compile(r"https?://", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")
_TRAILING_SENTENCE_MARKS = re.compile(r"[.!?。？！]+$")
_DRAFT_ITEM_SECTION_TITLES = {
    LectureNoteDraftItemType.DEFINITION: "개념",
    LectureNoteDraftItemType.FACT: "사실",
    LectureNoteDraftItemType.MECHANISM: "동작 원리",
    LectureNoteDraftItemType.PROCEDURE: "처리 순서",
    LectureNoteDraftItemType.EXAMPLE: "예시",
    LectureNoteDraftItemType.CAUTION: "주의사항",
}


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


def apply_draft_update(
    note: LectureNoteDraft,
    result: LectureNoteDraftUpdateResult,
) -> LectureNoteDraft:
    """활성 topic snapshot을 교체하거나 이전 topic 확정과 새 topic 생성을 함께 반영한다."""
    validate_draft_update(note, result)
    if result.action is LectureNoteDraftUpdateAction.IGNORE:
        return note

    active = note.topics[-1] if note.topics else None
    if result.action is LectureNoteDraftUpdateAction.UPDATE_CURRENT:
        if (
            active is None or result.currentTopic is None
        ):  # pragma: no cover - model validation 보강
            raise ValueError("UPDATE_CURRENT requires an active topic")
        updated = _replace_draft_topic(
            active,
            result.currentTopic,
            status=LectureNoteTopicStatus.ACTIVE,
        )
        if updated == active:
            return note
        return LectureNoteDraft(
            topics=(*note.topics[:-1], updated),
            update_sequence=note.update_sequence + 1,
        )

    if result.newTopic is None:  # pragma: no cover - model validation이 보장한다
        raise ValueError("START_NEW requires new topic content")
    new_topic = _new_draft_topic(len(note.topics) + 1, result.newTopic)
    if active is None:
        if note.topics or result.currentTopic is not None:
            raise ValueError("first START_NEW must not include current topic content")
        topics = (new_topic,)
    else:
        if result.currentTopic is None:
            raise ValueError("topic transition must finalize the active topic")
        finalized = _replace_draft_topic(
            active,
            result.currentTopic,
            status=LectureNoteTopicStatus.FINALIZED,
        )
        topics = (*note.topics[:-1], finalized, new_topic)
    return LectureNoteDraft(topics=topics, update_sequence=note.update_sequence + 1)


def validate_draft_update(
    note: LectureNoteDraft,
    result: LectureNoteDraftUpdateResult,
) -> None:
    """모델 결과가 현재 draft의 전이·용량·정보 보존 경계를 지키는지 검증한다."""
    if result.action is LectureNoteDraftUpdateAction.IGNORE:
        return

    active = note.topics[-1] if note.topics else None
    if active is None:
        if result.action is LectureNoteDraftUpdateAction.UPDATE_CURRENT:
            raise ValueError("UPDATE_CURRENT requires an active topic")
        if result.currentTopic is not None:
            raise ValueError("first START_NEW must not include current topic content")
        return
    if active.status is not LectureNoteTopicStatus.ACTIVE:
        raise ValueError("non-empty lecture note draft must end with an active topic")
    if result.currentTopic is None:
        raise ValueError("existing active topic requires currentTopic")
    existing_identities = {_draft_item_identity(item) for item in active.items}
    updated_identities = {_draft_item_identity(item) for item in result.currentTopic.items}
    if not existing_identities.issubset(updated_identities):
        raise ValueError("active topic update must preserve all existing items")


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


def render_refined_markdown(topics: tuple[LectureNoteRefinedTopic, ...]) -> str:
    sections: list[str] = []
    for topic in topics:
        lines = [f"## {_safe_inline_markdown(topic.topicTitle)}", ""]
        lines.extend(f"- {_safe_inline_markdown(point)}" for point in topic.keyPoints)
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def render_draft_topic_markdown(topic: LectureNoteDraftTopic) -> str:
    lines = [
        f"## {_safe_inline_markdown(topic.title)}",
        "",
        _safe_inline_markdown(topic.overview),
    ]
    for item_type, section_title in _DRAFT_ITEM_SECTION_TITLES.items():
        items = tuple(item for item in topic.items if item.type is item_type)
        if not items:
            continue
        lines.extend(("", f"### {section_title}", ""))
        lines.extend(_render_draft_item(item) for item in items)
    return "\n".join(lines)


def render_draft_markdown(note: LectureNoteDraft) -> str:
    return "\n\n".join(render_draft_topic_markdown(topic) for topic in note.topics)


def _new_draft_topic(
    topic_number: int,
    content: LectureNoteDraftTopicContent,
) -> LectureNoteDraftTopic:
    return LectureNoteDraftTopic(
        topic_id=f"topic-{topic_number}",
        revision=1,
        status=LectureNoteTopicStatus.ACTIVE,
        title=content.topicTitle,
        overview=content.overview,
        items=_unique_draft_items(content.items),
    )


def _replace_draft_topic(
    current: LectureNoteDraftTopic,
    content: LectureNoteDraftTopicContent,
    *,
    status: LectureNoteTopicStatus,
) -> LectureNoteDraftTopic:
    items = _unique_draft_items(content.items)
    unchanged = (
        current.status is status
        and current.title == content.topicTitle
        and current.overview == content.overview
        and current.items == items
    )
    if unchanged:
        return current
    return LectureNoteDraftTopic(
        topic_id=current.topic_id,
        revision=current.revision + 1,
        status=status,
        title=content.topicTitle,
        overview=content.overview,
        items=items,
    )


def _unique_draft_items(
    items: tuple[LectureNoteDraftItem, ...],
) -> tuple[LectureNoteDraftItem, ...]:
    unique: list[LectureNoteDraftItem] = []
    seen: set[tuple[LectureNoteDraftItemType, str, str]] = set()
    for item in items:
        label = "" if item.label is None else _normalize_for_comparison(item.label)
        key = (item.type, label, _normalize_for_comparison(item.content))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return tuple(unique)


def _draft_item_identity(item: LectureNoteDraftItem) -> tuple[LectureNoteDraftItemType, str]:
    identity = item.label if item.label is not None else item.content
    return item.type, _normalize_for_comparison(identity)


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


def _render_draft_item(item: LectureNoteDraftItem) -> str:
    content = _safe_inline_markdown(item.content)
    if item.label is None:
        return f"- {content}"
    return f"- **{_safe_inline_markdown(item.label)}** — {content}"


def _normalize_for_comparison(value: str) -> str:
    normalized = _WHITESPACE.sub(" ", unicodedata.normalize("NFC", value).strip())
    return _TRAILING_SENTENCE_MARKS.sub("", normalized).rstrip().casefold()


def _safe_inline_markdown(value: str) -> str:
    # 구조는 애플리케이션이 만들고 모델 text에는 bold와 inline code만 남긴다.
    escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace("[", r"\[").replace("]", r"\]")
    return _EXTERNAL_URL.sub(lambda match: match.group(0).replace(":", "&#58;"), escaped)
