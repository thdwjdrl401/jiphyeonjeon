import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import jsonschema
import pytest

from app.adapters.redis_caption_publisher import to_stream_fields
from app.adapters.spring_status_callback import serialize_status_event, status_signature
from app.captions.models import CaptionDelta, CaptionStreamCompleted
from app.contracts.live_status import LiveAgentStatusEvent

CONTRACTS = Path(__file__).parents[1] / "contracts"
SCHEMAS = CONTRACTS / "schemas"
FIXTURES = CONTRACTS / "fixtures"
FORMAT_CHECKER = jsonschema.FormatChecker()
SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")


def load_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def validator(name: str) -> jsonschema.Draft202012Validator:
    schema = load_json(SCHEMAS / name)
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema, format_checker=FORMAT_CHECKER)


@pytest.mark.parametrize(
    ("schema_name", "fixture_name"),
    [
        ("dispatch-metadata.schema.json", "dispatch-metadata.valid.json"),
        ("caption-stream-entry.schema.json", "caption-delta.valid.json"),
        ("caption-stream-entry.schema.json", "caption-completed.valid.json"),
        ("live-agent-status.schema.json", "live-agent-status-succeeded.valid.json"),
        ("live-agent-status.schema.json", "live-agent-status-failed.valid.json"),
    ],
)
def test_candidate_fixtures_validate(schema_name: str, fixture_name: str) -> None:
    validator(schema_name).validate(load_json(FIXTURES / fixture_name))


def test_caption_fixtures_are_exact_runtime_serializer_outputs() -> None:
    delta = CaptionDelta(
        event_id="caption-event-1",
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        stt_session_id="openai-realtime:session-1",
        sequence=1,
        stream_elapsed_ms=41_000,
        text=" 외",
        occurred_at=datetime(2026, 7, 27, 12, 34, 56, 789000, tzinfo=UTC),
    )
    completed = CaptionStreamCompleted(
        event_id="caption-event-2",
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        stt_session_id="openai-realtime:session-1",
        last_sequence=1,
        stream_elapsed_ms=41_000,
        reason="ROOM_DELETED",
        occurred_at=datetime(2026, 7, 27, 12, 35, tzinfo=UTC),
    )

    assert to_stream_fields(delta) == load_json(FIXTURES / "caption-delta.valid.json")
    assert to_stream_fields(completed) == load_json(FIXTURES / "caption-completed.valid.json")


def test_status_fixture_is_exact_runtime_serializer_output() -> None:
    event = LiveAgentStatusEvent(
        event_id="status-event-1",
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        job_id="livekit-job-1",
        state="SUCCEEDED",
        occurred_at=datetime(2026, 7, 27, 12, 35, tzinfo=UTC),
    )

    serialized = json.loads(serialize_status_event(event))

    assert serialized == load_json(FIXTURES / "live-agent-status-succeeded.valid.json")


def test_status_signing_fixture_is_an_exact_cross_language_vector() -> None:
    fixture = load_json(FIXTURES / "live-agent-status-signing.valid.json")
    raw_body = fixture["rawBody"]
    timestamp = fixture["timestamp"]
    secret = fixture["secret"]
    assert isinstance(raw_body, str)
    assert isinstance(timestamp, str)
    assert isinstance(secret, str)
    assert (
        raw_body.encode("utf-8")
        == (FIXTURES / "live-agent-status-succeeded.valid.json").read_bytes().strip()
    )

    assert (
        status_signature(
            secret.encode("utf-8"),
            timestamp,
            raw_body.encode("utf-8"),
        )
        == fixture["expectedSignature"]
    )


def test_schemas_reject_contract_drift_and_unimplemented_completion_reason() -> None:
    dispatch = load_json(FIXTURES / "dispatch-metadata.valid.json")
    dispatch["instructorIdentity"] = "instructor-1"
    with pytest.raises(jsonschema.ValidationError):
        validator("dispatch-metadata.schema.json").validate(dispatch)

    caption = load_json(FIXTURES / "caption-delta.valid.json")
    caption["text"] = ""
    with pytest.raises(jsonschema.ValidationError):
        validator("caption-stream-entry.schema.json").validate(caption)
    caption["text"] = "valid"
    caption["sequence"] = "1000000000000000000"
    with pytest.raises(jsonschema.ValidationError):
        validator("caption-stream-entry.schema.json").validate(caption)

    completed = load_json(FIXTURES / "caption-completed.valid.json")
    completed["reason"] = "SESSION_ENDED"
    with pytest.raises(jsonschema.ValidationError):
        validator("caption-stream-entry.schema.json").validate(completed)

    completed = load_json(FIXTURES / "caption-completed.valid.json")
    del completed["sttSessionId"]
    with pytest.raises(jsonschema.ValidationError):
        validator("caption-stream-entry.schema.json").validate(completed)


def test_status_schema_requires_error_only_for_failed() -> None:
    succeeded = load_json(FIXTURES / "live-agent-status-succeeded.valid.json")
    succeeded["error"] = {
        "code": "INVALID",
        "message": "must not be present",
        "retryable": False,
    }
    with pytest.raises(jsonschema.ValidationError):
        validator("live-agent-status.schema.json").validate(succeeded)

    failed = deepcopy(load_json(FIXTURES / "live-agent-status-failed.valid.json"))
    del failed["error"]
    with pytest.raises(jsonschema.ValidationError):
        validator("live-agent-status.schema.json").validate(failed)
