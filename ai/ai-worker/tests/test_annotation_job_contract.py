from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.contracts import (
    AnnotationCallbackEvent,
    AnnotationEmbedDeleteJob,
    AnnotationEmbedJob,
    annotation_callback_event_id,
    parse_material_job,
)
from app.contracts.material_jobs import MAX_ANNOTATION_TEXT_CHARS


SNAPSHOT_ID = "550e8400-e29b-41d4-a716-446655440010"
ASSET_ID = "550e8400-e29b-41d4-a716-446655440011"
SESSION_ID = "550e8400-e29b-41d4-a716-446655440012"
LESSON_ID = "550e8400-e29b-41d4-a716-446655440013"
CURRICULUM_ID = "550e8400-e29b-41d4-a716-446655440014"


def _embed_payload(**overrides: object) -> dict[str, object]:
    return {
        "taskType": "ANNOTATION_EMBED",
        "snapshotId": SNAPSHOT_ID,
        "assetId": ASSET_ID,
        "sessionId": SESSION_ID,
        "lessonId": LESSON_ID,
        "curriculumId": CURRICULUM_ID,
        "sessionMs": 725300,
        "capturedAt": "2026-08-04T13:20:05+09:00",
        "interpretedText": "B+ tree 노드 분할 조건",
        "policy": {"embedModel": "bge-m3"},
        "contractVersion": 1,
        **overrides,
    }


def _delete_payload(**overrides: object) -> dict[str, object]:
    return {
        "taskType": "ANNOTATION_EMBED_DELETE",
        "snapshotId": SNAPSHOT_ID,
        "contractVersion": 1,
        **overrides,
    }


def _body(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()


def test_parses_documented_annotation_embed_envelope_with_camel_case_only() -> None:
    job = parse_material_job(_body(_embed_payload()))

    assert isinstance(job, AnnotationEmbedJob)
    assert job.snapshot_id == UUID(SNAPSHOT_ID)
    assert job.asset_id == UUID(ASSET_ID)
    assert job.session_id == UUID(SESSION_ID)
    assert job.lesson_id == UUID(LESSON_ID)
    assert job.curriculum_id == UUID(CURRICULUM_ID)
    assert job.session_ms == 725300
    assert job.captured_at == datetime(
        2026, 8, 4, 13, 20, 5, tzinfo=timezone(timedelta(hours=9))
    )
    assert job.interpreted_text == "B+ tree 노드 분할 조건"
    assert job.policy.embed_model == "bge-m3"
    assert job.contract_version == 1


def test_parses_annotation_embed_without_interpreted_text() -> None:
    """Spring may have no interpretation of its own — the worker reads the image instead."""
    payload = _embed_payload()
    del payload["interpretedText"]

    job = parse_material_job(_body(payload))

    assert isinstance(job, AnnotationEmbedJob)
    assert job.interpreted_text is None


def test_parses_documented_annotation_delete_envelope() -> None:
    job = parse_material_job(_body(_delete_payload()))

    assert isinstance(job, AnnotationEmbedDeleteJob)
    assert job.snapshot_id == UUID(SNAPSHOT_ID)
    assert job.contract_version == 1


def test_annotation_jobs_share_the_queue_without_disturbing_material_jobs() -> None:
    """Both families are discriminated by taskType on the same ingestion.embed queue."""
    material = parse_material_job(
        _body(
            {
                "taskType": "EMBED_DELETE",
                "materialId": SNAPSHOT_ID,
                "lessonId": LESSON_ID,
                "contractVersion": 1,
            }
        )
    )
    annotation = parse_material_job(_body(_delete_payload()))

    assert type(material) is not type(annotation)


@pytest.mark.parametrize(
    "payload",
    [
        _embed_payload(contractVersion=2),
        _embed_payload(policy={"embedModel": "other"}),
        _embed_payload(snapshotId="not-a-uuid"),
        _embed_payload(sessionMs=-1),
        # A naive timestamp cannot be placed on a real timeline.
        _embed_payload(capturedAt="2026-08-04T13:20:05"),
        # Text we cannot store must not be silently truncated.
        _embed_payload(interpretedText="가" * (MAX_ANNOTATION_TEXT_CHARS + 1)),
        _embed_payload(unexpected=True),
        {**_embed_payload(), "snapshot_id": SNAPSHOT_ID},
        _delete_payload(contractVersion=2),
        _delete_payload(unexpected=True),
    ],
)
def test_rejects_unsupported_or_drifting_annotation_contract(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        parse_material_job(_body(payload))


def test_annotation_delete_does_not_accept_material_scope_fields() -> None:
    """Deleting a snapshot needs only its id — no lesson or curriculum scope is echoed."""
    with pytest.raises(ValidationError):
        parse_material_job(_body(_delete_payload(lessonId=LESSON_ID)))


def test_terminal_callback_body_carries_only_snapshot_identity() -> None:
    event = AnnotationCallbackEvent(
        eventId=annotation_callback_event_id(
            f"ANNOTATION_EMBED:{SNAPSHOT_ID}", "ANNOTATION_EMBEDDED"
        ),
        eventType="ANNOTATION_EMBEDDED",
        jobId=f"ANNOTATION_EMBED:{SNAPSHOT_ID}",
        snapshotId=UUID(SNAPSHOT_ID),
        status="READY",
    )

    body = json.loads(event.raw_body())

    assert body["eventType"] == "ANNOTATION_EMBEDDED"
    assert body["snapshotId"] == SNAPSHOT_ID
    assert body["status"] == "READY"
    assert "materialId" not in body
    assert "keyTerms" not in body


@pytest.mark.parametrize(
    ("event_type", "status"),
    [
        ("ANNOTATION_EMBEDDED", "READY"),
        ("ANNOTATION_EMBED_FAILED", "FAILED"),
        ("ANNOTATION_EMBEDDING", "PROCESSING"),
    ],
)
def test_callback_status_pairs_with_its_event_type(event_type: str, status: str) -> None:
    event = AnnotationCallbackEvent(
        eventId=annotation_callback_event_id("job-1", event_type),
        eventType=event_type,
        jobId="job-1",
        snapshotId=UUID(SNAPSHOT_ID),
        status=status,
    )

    assert event.status == status


def test_callback_rejects_status_that_contradicts_its_event_type() -> None:
    with pytest.raises(ValidationError, match="status must match eventType"):
        AnnotationCallbackEvent(
            eventId=annotation_callback_event_id("job-1", "ANNOTATION_EMBED_FAILED"),
            eventType="ANNOTATION_EMBED_FAILED",
            jobId="job-1",
            snapshotId=UUID(SNAPSHOT_ID),
            status="READY",
        )


def test_callback_event_id_is_stable_per_job_and_event_type() -> None:
    """HTTP retries of one result must reuse the same eventId for Spring-side dedupe."""
    job_id = f"ANNOTATION_EMBED:{SNAPSHOT_ID}"

    first = annotation_callback_event_id(job_id, "ANNOTATION_EMBEDDED")
    second = annotation_callback_event_id(job_id, "ANNOTATION_EMBEDDED")
    failed = annotation_callback_event_id(job_id, "ANNOTATION_EMBED_FAILED")

    assert first == second
    assert first != failed


def test_callback_event_id_rejects_blank_or_padded_job_id() -> None:
    with pytest.raises(ValueError, match="blank or padded"):
        annotation_callback_event_id("  job-1", "ANNOTATION_EMBEDDED")
