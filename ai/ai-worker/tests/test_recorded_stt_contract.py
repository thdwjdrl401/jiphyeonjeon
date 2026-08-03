import json
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.recorded_stt.contracts import RecordedSttJob, parse_recorded_stt_job

JOB_ID = "80000000-0000-4000-8000-000000000001"
VIDEO_ID = "50000000-0000-4000-8000-000000000001"


def _payload(**overrides: object) -> dict[str, object]:
    return {
        "taskType": "RECORDED_STT",
        "jobId": JOB_ID,
        "recordedVideoId": VIDEO_ID,
        "lessonId": "10000000-0000-4000-8000-000000000001",
        "sourceAssetId": "60000000-0000-4000-8000-000000000001",
        "language": "ko",
        "contractVersion": 1,
        **overrides,
    }


def test_parses_strict_camel_case_recorded_stt_job() -> None:
    job = parse_recorded_stt_job(json.dumps(_payload()).encode())

    assert isinstance(job, RecordedSttJob)
    assert job.job_id == UUID(JOB_ID)
    assert job.recorded_video_id == UUID(VIDEO_ID)
    assert job.language == "ko"


@pytest.mark.parametrize(
    "payload",
    [
        _payload(job_id=JOB_ID),
        _payload(extra="not-allowed"),
        _payload(model="whisper-1"),
        _payload(language="en"),
        _payload(contractVersion=2),
    ],
)
def test_rejects_contract_drift(payload: dict[str, object]) -> None:
    with pytest.raises((ValueError, ValidationError)):
        parse_recorded_stt_job(json.dumps(payload).encode())


def test_rejects_empty_or_oversized_job_body() -> None:
    with pytest.raises(ValueError):
        parse_recorded_stt_job(b"")
    with pytest.raises(ValueError):
        parse_recorded_stt_job(b"x" * (64 * 1024 + 1))
