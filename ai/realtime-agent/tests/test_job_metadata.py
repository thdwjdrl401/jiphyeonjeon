import json
from pathlib import Path
from uuid import UUID

import pytest

from app.jobs.metadata import (
    MAX_JOB_METADATA_BYTES,
    InvalidJobMetadataError,
    JobMetadata,
)

CONTRACTS = Path(__file__).parents[1] / "contracts"
SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"


def valid_metadata(**changes: object) -> str:
    payload: dict[str, object] = {
        "contractVersion": "1",
        "sessionId": SESSION_ID,
        "lessonId": LESSON_ID,
        "correlationId": "trace.live-1",
    }
    payload.update(changes)
    return json.dumps(payload, separators=(",", ":"))


def test_parses_exact_dispatch_metadata_fixture() -> None:
    raw = (
        (CONTRACTS / "fixtures" / "dispatch-metadata.valid.json")
        .read_text(encoding="utf-8")
        .strip()
    )

    metadata = JobMetadata.parse(raw)

    assert metadata == JobMetadata(
        contract_version="1",
        session_id=UUID(SESSION_ID),
        lesson_id=UUID(LESSON_ID),
        correlation_id="trace.live-1",
    )
    assert JobMetadata.parse(metadata.to_json()) == metadata


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("not-json", "valid JSON"),
        ("[]", "JSON object"),
        (valid_metadata(contractVersion="2"), "contractVersion"),
        (valid_metadata(sessionId=12), "sessionId"),
        (valid_metadata(sessionId="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"), "sessionId"),
        (valid_metadata(sessionId="{11111111-1111-4111-8111-111111111111}"), "sessionId"),
        (valid_metadata(lessonId="not-a-uuid"), "lessonId"),
        (valid_metadata(correlationId="../unsafe"), "correlationId"),
        (valid_metadata(correlationId="x" * 129), "correlationId"),
        (valid_metadata(instructorIdentity="instructor-1"), "unknown"),
    ],
)
def test_rejects_invalid_or_noncanonical_metadata(raw: str, message: str) -> None:
    with pytest.raises(InvalidJobMetadataError, match=message):
        JobMetadata.parse(raw)


def test_rejects_missing_and_duplicate_fields() -> None:
    with pytest.raises(InvalidJobMetadataError, match="missing.*lessonId"):
        JobMetadata.parse(
            f'{{"contractVersion":"1","sessionId":"{SESSION_ID}","correlationId":"trace-1"}}'
        )

    duplicate = (
        f'{{"contractVersion":"1","sessionId":"{SESSION_ID}",'
        f'"lessonId":"{LESSON_ID}","correlationId":"trace-1",'
        '"correlationId":"trace-2"}'
    )
    with pytest.raises(InvalidJobMetadataError, match="duplicate.*correlationId"):
        JobMetadata.parse(duplicate)


def test_rejects_oversize_metadata_by_utf8_bytes_before_parsing() -> None:
    raw = "가" * (MAX_JOB_METADATA_BYTES // 3 + 1)

    with pytest.raises(InvalidJobMetadataError, match="4096 UTF-8 bytes"):
        JobMetadata.parse(raw)
