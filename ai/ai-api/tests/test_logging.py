import json
import logging
from uuid import UUID

from app.logging_config import JsonFormatter


def test_json_log_contains_only_allowlisted_context_fields() -> None:
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "ignored", (), None)
    record.event = "request.completed"
    record.correlation_id = UUID("12345678-1234-5678-1234-567812345678")
    record.duration_ms = 12
    record.api_key = "must-not-appear"

    rendered = JsonFormatter("ai-api").format(record)
    payload = json.loads(rendered)

    assert payload["service"] == "ai-api"
    assert payload["event"] == "request.completed"
    assert payload["correlation_id"] == "12345678-1234-5678-1234-567812345678"
    assert payload["duration_ms"] == 12
    assert "must-not-appear" not in rendered
