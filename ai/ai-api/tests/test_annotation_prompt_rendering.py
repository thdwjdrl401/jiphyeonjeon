"""How annotation evidence reaches the model (ADR-0043 §5-2).

The time deixis in "아까 강조하신 게 뭐였지" is resolved by the model comparing clock faces,
so those clock faces have to actually be in the prompt.
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest

from app.adapters.gms_openai_answer import _SYSTEM_PROMPT, _clock, _prompt_payload
from app.adapters.gms_openai_answer_v2 import _prompt_payload_v2
from app.rag.models import (
    AnnotationSource,
    AnnotationSourceV2,
    PptxSource,
    PptxSourceV2,
    RagAnswerRequest,
    RagAnswerRequestV2,
    RetrievedEvidence,
    RetrievedEvidenceV2,
)


LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
CURRICULUM_ID = UUID("44444444-4444-4444-8444-444444444444")
MATERIAL_ID = UUID("22222222-2222-4222-8222-222222222222")
SESSION_ID = "33333333-3333-4333-8333-333333333333"


@pytest.mark.parametrize(
    ("session_ms", "expected"),
    [
        (0, "00:00"),
        (5_000, "00:05"),
        (725_300, "12:05"),
        (3_599_000, "59:59"),
        (3_600_000, "1:00:00"),
        (7_385_000, "2:03:05"),
        # Defensive: a negative anchor should not render as a bizarre clock.
        (-1, "00:00"),
    ],
)
def test_clock_renders_session_ms_as_a_readable_face(session_ms: int, expected: str) -> None:
    assert _clock(session_ms) == expected


def _live_evidence(session_ms: int = 725_300) -> RetrievedEvidence:
    return RetrievedEvidence(
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        content="B+ tree 노드 분할 조건",
        source=AnnotationSource(
            snapshotId=uuid4(), sessionId=SESSION_ID, sessionMs=session_ms
        ),
    )


def _live_request() -> RagAnswerRequest:
    return RagAnswerRequest(
        requestId="request-1",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="아까 강조하신 게 뭐였지?",
        contextTimeMs=615_000,
        issuedAtMs=1_785_120_000_000,
    )


def _replay_request(question_session_ms: int = 735_000) -> RagAnswerRequestV2:
    return RagAnswerRequestV2(
        requestId="request-1",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="아까 강조하신 게 뭐였지?",
        context={"mode": "REPLAY", "questionSessionMs": question_session_ms, "captions": []},
        issuedAtMs=1_785_450_000_000,
    )


def test_live_prompt_labels_each_annotation_with_its_clock_face() -> None:
    payload = json.loads(_prompt_payload(_live_request(), [_live_evidence()]))

    source = payload["evidence"][0]["source"]
    assert source["type"] == "ANNOTATION"
    assert source["highlightedAt"] == "12:05"
    assert source["sessionMs"] == 725_300
    assert payload["evidence"][0]["content"] == "B+ tree 노드 분할 조건"


def test_live_prompt_has_no_askedAt_because_there_is_no_comparable_now() -> None:
    """contextTimeMs is STT attempt-local; presenting it as a session clock would invite the
    model to compare two different timelines."""
    payload = json.loads(_prompt_payload(_live_request(), [_live_evidence()]))

    assert "askedAt" not in payload


def test_replay_prompt_gives_the_model_both_ends_of_the_comparison() -> None:
    evidence = RetrievedEvidenceV2(
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        content="B+ tree 노드 분할 조건",
        source=AnnotationSourceV2(
            snapshotId=uuid4(),
            sessionId=SESSION_ID,
            sessionMs=725_300,
            excerpt="B+ tree 노드 분할 조건",
        ),
    )

    payload = json.loads(_prompt_payload_v2(_replay_request(735_000), [evidence]))

    assert payload["askedAt"] == "12:15"
    assert payload["evidence"][0]["source"]["highlightedAt"] == "12:05"


def test_prompts_do_not_leak_snapshot_identifiers_to_the_model() -> None:
    """The model cites nothing itself — the server attaches sources — so an opaque UUID would
    only be tokens spent on noise."""
    live = _prompt_payload(_live_request(), [_live_evidence()])
    replay = _prompt_payload_v2(
        _replay_request(),
        [
            RetrievedEvidenceV2(
                lesson_id=LESSON_ID,
                content="근거",
                source=AnnotationSourceV2(
                    snapshotId=uuid4(),
                    sessionId=SESSION_ID,
                    sessionMs=1,
                    excerpt="근거",
                ),
            )
        ],
    )

    assert "snapshotId" not in live
    assert "snapshotId" not in replay


def test_material_evidence_rendering_is_unchanged_alongside_annotations() -> None:
    material = RetrievedEvidence(
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        content="자료 근거",
        source=PptxSource(materialId=MATERIAL_ID, page=4),
    )

    payload = json.loads(_prompt_payload(_live_request(), [material, _live_evidence()]))

    assert payload["evidence"][0]["source"] == {"type": "PPTX", "page": 4}
    assert payload["evidence"][1]["source"]["type"] == "ANNOTATION"


def test_replay_material_evidence_rendering_is_unchanged() -> None:
    material = RetrievedEvidenceV2(
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        content="자료 근거",
        source=PptxSourceV2(materialId=MATERIAL_ID, page=4, excerpt="자료 근거"),
    )

    payload = json.loads(_prompt_payload_v2(_replay_request(), [material]))

    assert payload["evidence"][0]["source"] == {"type": "PPTX", "page": 4}


def test_system_prompt_tells_the_model_how_to_resolve_a_time_question() -> None:
    assert "ANNOTATION" in _SYSTEM_PROMPT
    assert "highlightedAt" in _SYSTEM_PROMPT
    assert "아까" in _SYSTEM_PROMPT
    assert "askedAt" in _SYSTEM_PROMPT
