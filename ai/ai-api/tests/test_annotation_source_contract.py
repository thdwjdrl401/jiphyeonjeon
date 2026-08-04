"""Wire contract for the ANNOTATION answer source (ADR-0043 §6).

Spring relays answer events to the browser without transforming them, so the shape asserted
here is exactly what the client renders and seeks with.
"""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from pydantic import TypeAdapter, ValidationError

from app.rag import (
    AnnotationSource,
    AnnotationSourceV2,
    AnswerDone,
    AnswerDoneV2,
    AnswerSource,
    AnswerSourceV2,
    encode_sse_event,
)
from app.rag.models import AnswerDoneData, AnswerDoneDataV2


SNAPSHOT_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
SESSION_ID = "11111111-1111-4111-8111-111111111111"


def test_v1_annotation_source_carries_snapshot_identity_and_timeline_anchor() -> None:
    source = AnnotationSource(
        snapshotId=SNAPSHOT_ID,
        sessionId=SESSION_ID,
        sessionMs=725_300,
        excerpt="B+ tree 노드 분할 조건",
    )

    body = json.loads(source.model_dump_json())

    assert body == {
        "type": "ANNOTATION",
        "snapshotId": str(SNAPSHOT_ID),
        "sessionId": SESSION_ID,
        "sessionMs": 725_300,
        "excerpt": "B+ tree 노드 분할 조건",
    }
    # A snapshot has no page: claiming one would misreport where the answer came from.
    assert "page" not in body
    assert "materialId" not in body


def test_v1_annotation_excerpt_stays_optional_like_other_v1_sources() -> None:
    source = AnnotationSource(snapshotId=SNAPSHOT_ID, sessionId=SESSION_ID, sessionMs=0)

    assert source.excerpt is None


def test_v2_annotation_source_requires_an_excerpt() -> None:
    """Replay answers must always show the user what they were grounded in."""
    with pytest.raises(ValidationError):
        AnnotationSourceV2(snapshotId=SNAPSHOT_ID, sessionId=SESSION_ID, sessionMs=725_300)


def test_v2_annotation_excerpt_is_capped_at_300_characters() -> None:
    AnnotationSourceV2(
        snapshotId=SNAPSHOT_ID, sessionId=SESSION_ID, sessionMs=1, excerpt="가" * 300
    )

    with pytest.raises(ValidationError):
        AnnotationSourceV2(
            snapshotId=SNAPSHOT_ID, sessionId=SESSION_ID, sessionMs=1, excerpt="가" * 301
        )


@pytest.mark.parametrize("source_type", [AnnotationSource, AnnotationSourceV2])
def test_annotation_source_rejects_negative_session_ms(source_type: type) -> None:
    with pytest.raises(ValidationError):
        source_type(
            snapshotId=SNAPSHOT_ID, sessionId=SESSION_ID, sessionMs=-1, excerpt="근거"
        )


@pytest.mark.parametrize("source_type", [AnnotationSource, AnnotationSourceV2])
def test_annotation_source_rejects_unknown_fields(source_type: type) -> None:
    with pytest.raises(ValidationError):
        source_type(
            snapshotId=SNAPSHOT_ID,
            sessionId=SESSION_ID,
            sessionMs=1,
            excerpt="근거",
            page=3,
        )


def test_annotation_is_discriminated_from_pptx_and_caption_in_both_unions() -> None:
    payload = {
        "type": "ANNOTATION",
        "snapshotId": str(SNAPSHOT_ID),
        "sessionId": SESSION_ID,
        "sessionMs": 725_300,
        "excerpt": "근거",
    }

    assert isinstance(TypeAdapter(AnswerSource).validate_python(payload), AnnotationSource)
    assert isinstance(
        TypeAdapter(AnswerSourceV2).validate_python(payload), AnnotationSourceV2
    )


def test_answer_done_streams_annotation_alongside_material_sources() -> None:
    event = AnswerDoneV2(
        data=AnswerDoneDataV2(
            requestId="request-1",
            sources=(
                AnnotationSourceV2(
                    snapshotId=SNAPSHOT_ID,
                    sessionId=SESSION_ID,
                    sessionMs=725_300,
                    excerpt="강조 근거",
                ),
            ),
        )
    )

    encoded = encode_sse_event(event).decode()
    header, data = encoded.split("\n", 1)

    assert header == "event: answer.done"
    assert json.loads(data.removeprefix("data: ").strip())["sources"][0]["type"] == "ANNOTATION"


def test_v1_answer_done_accepts_annotation_sources() -> None:
    event = AnswerDone(
        data=AnswerDoneData(
            requestId="request-1",
            sources=(
                AnnotationSource(
                    snapshotId=SNAPSHOT_ID, sessionId=SESSION_ID, sessionMs=725_300
                ),
            ),
        )
    )

    assert event.data.sources[0].type == "ANNOTATION"
