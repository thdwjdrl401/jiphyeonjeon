import pytest
from pydantic import ValidationError

from app.lecture_notes import (
    LectureNoteDraft,
    LectureNoteDraftItem,
    LectureNoteDraftItemType,
    LectureNoteDraftTopicContent,
    LectureNoteDraftUpdateAction,
    LectureNoteDraftUpdateResult,
    LectureNoteTopicStatus,
    apply_draft_update,
    render_draft_markdown,
)


def _item(
    item_type: LectureNoteDraftItemType,
    content: str,
    *,
    label: str | None = None,
) -> LectureNoteDraftItem:
    return LectureNoteDraftItem(type=item_type, label=label, content=content)


def _content(
    title: str,
    overview: str,
    *items: LectureNoteDraftItem,
) -> LectureNoteDraftTopicContent:
    return LectureNoteDraftTopicContent(
        topicTitle=title,
        overview=overview,
        items=items or (_item(LectureNoteDraftItemType.FACT, overview),),
    )


def test_first_topic_starts_as_active_revision_one() -> None:
    note = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=_content("Consumer Group", "메시지를 소비자들이 나누어 처리함."),
        ),
    )

    assert note.update_sequence == 1
    assert note.topics[0].topic_id == "topic-1"
    assert note.topics[0].revision == 1
    assert note.topics[0].status is LectureNoteTopicStatus.ACTIVE
    assert render_draft_markdown(note) == (
        "## Consumer Group\n\n"
        "메시지를 소비자들이 나누어 처리함.\n\n"
        "### 사실\n\n"
        "- 메시지를 소비자들이 나누어 처리함."
    )


def test_update_current_preserves_existing_and_adds_structured_items() -> None:
    existing = _item(LectureNoteDraftItemType.FACT, "기존 사실이 있음.")
    initial = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=_content(
                "Consumer Group",
                "메시지를 소비자가 나누어 처리함.",
                existing,
            ),
        ),
    )

    updated = apply_draft_update(
        initial,
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
            currentTopic=_content(
                "Consumer Group과 ACK",
                "메시지를 나누어 처리하고 ACK로 완료 여부를 추적함.",
                existing,
                _item(
                    LectureNoteDraftItemType.MECHANISM,
                    "ACK되지 않은 메시지는 Pending에 남음.",
                ),
            ),
        ),
    )

    assert updated.update_sequence == 2
    assert updated.topics[0].topic_id == "topic-1"
    assert updated.topics[0].revision == 2
    assert updated.topics[0].items == (
        existing,
        _item(
            LectureNoteDraftItemType.MECHANISM,
            "ACK되지 않은 메시지는 Pending에 남음.",
        ),
    )


def test_unchanged_update_does_not_advance_revisions() -> None:
    content = _content("Consumer Group", "메시지를 소비자들이 나누어 처리함.")
    note = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=content,
        ),
    )

    unchanged = apply_draft_update(
        note,
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
            currentTopic=content,
        ),
    )

    assert unchanged == note
    assert (
        apply_draft_update(
            note,
            LectureNoteDraftUpdateResult(action=LectureNoteDraftUpdateAction.IGNORE),
        )
        == note
    )


@pytest.mark.parametrize(
    "action", [LectureNoteDraftUpdateAction.UPDATE_CURRENT, LectureNoteDraftUpdateAction.START_NEW]
)
def test_update_rejects_removing_existing_item(
    action: LectureNoteDraftUpdateAction,
) -> None:
    note = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=_content(
                "Consumer Group",
                "메시지를 소비자들이 나누어 처리함.",
                _item(LectureNoteDraftItemType.FACT, "기존 사실이 있음.", label="기존 사실"),
            ),
        ),
    )
    current_topic = _content(
        "Consumer Group",
        "새 정보만 남기려는 잘못된 갱신임.",
        _item(LectureNoteDraftItemType.FACT, "새 사실이 있음.", label="새 사실"),
    )
    result = LectureNoteDraftUpdateResult(
        action=action,
        currentTopic=current_topic,
        newTopic=(
            _content("새 주제", "새로운 주제를 시작함.")
            if action is LectureNoteDraftUpdateAction.START_NEW
            else None
        ),
    )

    with pytest.raises(ValueError, match="preserve all existing items"):
        apply_draft_update(note, result)


def test_full_topic_allows_update_when_all_item_identities_remain() -> None:
    items = tuple(
        _item(
            LectureNoteDraftItemType.FACT,
            f"기존 사실 {index}의 설명임.",
            label=f"기존 사실 {index}",
        )
        for index in range(12)
    )
    note = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=_content("가득 찬 주제", "열두 개 사실을 정리함.", *items),
        ),
    )
    rewritten_items = tuple(
        _item(item.type, f"{item.label}의 표현을 다듬어 설명함.", label=item.label)
        for item in items
    )

    updated = apply_draft_update(
        note,
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
            currentTopic=_content(
                "가득 찬 주제 정리",
                "새 사실을 추가하지 않고 기존 표현만 정리함.",
                *rewritten_items,
            ),
        ),
    )

    assert updated.update_sequence == 2
    assert updated.topics[0].items == rewritten_items


def test_first_topic_rejects_update_and_current_topic_payload() -> None:
    content = _content("현재 주제", "현재 설명임.")

    with pytest.raises(ValueError, match="requires an active topic"):
        apply_draft_update(
            LectureNoteDraft(),
            LectureNoteDraftUpdateResult(
                action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
                currentTopic=content,
            ),
        )
    with pytest.raises(ValueError, match="first START_NEW"):
        apply_draft_update(
            LectureNoteDraft(),
            LectureNoteDraftUpdateResult(
                action=LectureNoteDraftUpdateAction.START_NEW,
                currentTopic=content,
                newTopic=_content("새 주제", "새로운 주제를 시작함."),
            ),
        )


def test_start_new_finalizes_current_and_creates_one_active_topic() -> None:
    existing = _item(
        LectureNoteDraftItemType.FACT,
        "메시지를 나누어 처리함.",
        label="메시지 분배",
    )
    first = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=_content("Consumer Group", "메시지를 나누어 처리함.", existing),
        ),
    )

    transitioned = apply_draft_update(
        first,
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            currentTopic=_content(
                "Consumer Group과 ACK",
                "메시지 처리 완료 여부를 ACK로 관리함.",
                existing,
                _item(LectureNoteDraftItemType.FACT, "처리가 끝나면 ACK가 필요함."),
            ),
            newTopic=_content("Pending 복구", "ACK되지 않은 메시지를 다시 처리함."),
        ),
    )

    assert transitioned.update_sequence == 2
    assert [topic.topic_id for topic in transitioned.topics] == ["topic-1", "topic-2"]
    assert transitioned.topics[0].revision == 2
    assert transitioned.topics[0].status is LectureNoteTopicStatus.FINALIZED
    assert transitioned.topics[1].revision == 1
    assert transitioned.topics[1].status is LectureNoteTopicStatus.ACTIVE


def test_markdown_groups_items_by_information_role() -> None:
    note = apply_draft_update(
        LectureNoteDraft(),
        LectureNoteDraftUpdateResult(
            action=LectureNoteDraftUpdateAction.START_NEW,
            newTopic=_content(
                "<Consumer Group>",
                "`ACK`로 [완료](https://example.com)를 추적함.",
                _item(
                    LectureNoteDraftItemType.DEFINITION,
                    "처리 완료를 확인하는 신호임.",
                    label="ACK",
                ),
                _item(
                    LectureNoteDraftItemType.CAUTION,
                    "너무 이른 ACK는 결과 유실 위험이 있음.",
                ),
            ),
        ),
    )

    assert render_draft_markdown(note) == (
        "## &lt;Consumer Group&gt;\n\n"
        r"`ACK`로 \[완료\](https&#58;//example.com)를 추적함."
        "\n\n### 개념\n\n- **ACK** — 처리 완료를 확인하는 신호임."
        "\n\n### 주의사항\n\n- 너무 이른 ACK는 결과 유실 위험이 있음."
    )


def test_topic_content_rejects_polite_style_and_definition_without_label() -> None:
    with pytest.raises(ValidationError):
        _content("현재 주제", "현재 설명입니다.")
    with pytest.raises(ValidationError):
        _content("현재 주제", "현재 설명이다.")
    with pytest.raises(ValidationError):
        _item(LectureNoteDraftItemType.DEFINITION, "ACK의 정의임.")

    quoted_source = _content(
        "자막 결합",
        "인용된 발화는 그대로 두고 설명만 명사형으로 작성함.",
        _item(
            LectureNoteDraftItemType.EXAMPLE,
            "‘배워보겠습니다’처럼 잘린 자막도 순서대로 결합 가능함.",
        ),
    )
    assert quoted_source.items[0].content.endswith("가능함.")


@pytest.mark.parametrize(
    "payload",
    [
        {"action": "IGNORE", "currentTopic": _content("현재 주제", "현재 설명임.")},
        {"action": "UPDATE_CURRENT"},
        {
            "action": "UPDATE_CURRENT",
            "currentTopic": _content("현재 주제", "현재 설명임."),
            "newTopic": _content("새 주제", "새 설명임."),
        },
        {"action": "START_NEW"},
    ],
)
def test_update_result_rejects_invalid_action_payloads(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        LectureNoteDraftUpdateResult.model_validate(payload)
