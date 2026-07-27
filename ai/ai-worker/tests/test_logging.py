import json
import logging
from uuid import UUID

from app.logging_config import JsonFormatter


def test_json_log_uses_same_allowlisted_context_fields() -> None:
    record = logging.LogRecord("test", logging.WARNING, __file__, 1, "ignored", (), None)
    record.event = "job.failed"
    record.job_id = UUID("12345678-1234-5678-1234-567812345678")
    record.error_code = "TEST_FAILURE"
    record.password = "must-not-appear"

    rendered = JsonFormatter("ai-worker").format(record)
    payload = json.loads(rendered)

    assert payload["service"] == "ai-worker"
    assert payload["event"] == "job.failed"
    assert payload["job_id"] == "12345678-1234-5678-1234-567812345678"
    assert payload["error_code"] == "TEST_FAILURE"
    assert "must-not-appear" not in rendered
