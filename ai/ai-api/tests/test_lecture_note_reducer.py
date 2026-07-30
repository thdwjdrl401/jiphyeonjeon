import pytest
from pydantic import ValidationError

from app.lecture_notes import (
    LectureNote,
    LectureNoteModelResult,
    TopicAction,
    apply_model_result,
    render_markdown,
    render_markdown_fragment,
)


def _result(
    action: TopicAction,
    title: str,
    *points: str,
) -> LectureNoteModelResult:
    return LectureNoteModelResult(
        topicAction=action,
        topicTitle=title,
        keyPoints=points,
    )


def test_first_result_creates_topic_even_when_action_is_continue() -> None:
    note = apply_model_result(
        LectureNote(),
        _result(TopicAction.CONTINUE, "Refresh Token", "재발급에 사용한다."),
    )

    assert note.chunk_sequence == 1
    assert note.topics[0].topic_id == "topic-1"
    assert note.topics[0].title == "Refresh Token"
    assert note.topics[0].key_points == ("재발급에 사용한다.",)


def test_continue_keeps_title_and_removes_only_normalized_exact_points() -> None:
    note = apply_model_result(
        LectureNote(),
        _result(TopicAction.START_NEW, "기존 제목", "공통 요점"),
    )

    updated = apply_model_result(
        note,
        _result(TopicAction.CONTINUE, "모델의 새 제목", " 공통 요점 ", "추가 요점"),
    )

    assert updated.chunk_sequence == 2
    assert updated.topics[0].title == "기존 제목"
    assert updated.topics[0].key_points == ("공통 요점", "추가 요점")


def test_exact_duplicate_does_not_advance_chunk_sequence() -> None:
    note = apply_model_result(
        LectureNote(),
        _result(TopicAction.START_NEW, "기존 제목", "공통 요점"),
    )

    unchanged = apply_model_result(
        note,
        _result(TopicAction.CONTINUE, "기존 제목", "공통 요점"),
    )

    assert unchanged == note


def test_start_new_appends_deterministic_topic() -> None:
    first = apply_model_result(
        LectureNote(),
        _result(TopicAction.START_NEW, "첫 주제", "첫 요점"),
    )

    second = apply_model_result(
        first,
        _result(TopicAction.START_NEW, "둘째 주제", "둘째 요점"),
    )

    assert [topic.topic_id for topic in second.topics] == ["topic-1", "topic-2"]
    assert [topic.title for topic in second.topics] == ["첫 주제", "둘째 주제"]


def test_renderer_keeps_inline_emphasis_and_neutralizes_disallowed_markdown() -> None:
    note = apply_model_result(
        LectureNote(),
        _result(
            TopicAction.START_NEW,
            "<script> **강조**",
            "`code` [링크](https://example.com)",
        ),
    )

    assert render_markdown(note) == (
        "## &lt;script&gt; **강조**\n\n"
        r"- `code` \[링크\](https&#58;//example.com)"
    )
    assert (
        render_markdown_fragment(
            note.topics[0].title,
            ("새 요점",),
            TopicAction.CONTINUE,
        )
        == "- 새 요점"
    )


@pytest.mark.parametrize(
    "mutation",
    [
        {"topicAction": "UNKNOWN"},
        {"topicTitle": ""},
        {"topicTitle": "제목\n삽입"},
        {"keyPoints": []},
        {"keyPoints": ["1", "2", "3", "4"]},
        {"extra": "not-allowed"},
    ],
)
def test_model_result_rejects_values_outside_mvp_contract(mutation: dict[str, object]) -> None:
    payload: dict[str, object] = {
        "topicAction": "CONTINUE",
        "topicTitle": "주제",
        "keyPoints": ["요점"],
    }
    payload.update(mutation)

    with pytest.raises(ValidationError):
        LectureNoteModelResult.model_validate(payload)
