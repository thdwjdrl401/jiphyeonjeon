import json
import logging
from uuid import UUID

from app.logging_config import JsonFormatter, configure_logging


def test_json_log_uses_same_allowlisted_context_fields() -> None:
    record = logging.LogRecord("test", logging.WARNING, __file__, 1, "ignored", (), None)
    record.event = "job.failed"
    record.job_id = UUID("12345678-1234-5678-1234-567812345678")
    record.error_code = "TEST_FAILURE"
    record.error_reason = "TIMESTAMPS_MISSING"
    record.word_count = 13
    record.fallback_mode = "SEGMENT_PRIMARY"
    record.password = "must-not-appear"
    record.transcript = "must-not-appear-either"

    rendered = JsonFormatter("ai-worker").format(record)
    payload = json.loads(rendered)

    assert payload["service"] == "ai-worker"
    assert payload["event"] == "job.failed"
    assert payload["job_id"] == "12345678-1234-5678-1234-567812345678"
    assert payload["error_code"] == "TEST_FAILURE"
    assert payload["error_reason"] == "TIMESTAMPS_MISSING"
    assert payload["word_count"] == 13
    assert payload["fallback_mode"] == "SEGMENT_PRIMARY"
    assert "must-not-appear" not in rendered


def test_http_client_info_logs_cannot_expose_presigned_query() -> None:
    root = logging.getLogger()
    previous_handlers = root.handlers[:]
    previous_root_level = root.level
    previous_http_levels = {name: logging.getLogger(name).level for name in ("httpx", "httpcore")}
    try:
        configure_logging("ai-worker", "INFO")

        assert logging.getLogger("httpx").isEnabledFor(logging.INFO) is False
        assert logging.getLogger("httpcore").isEnabledFor(logging.INFO) is False
        assert logging.getLogger("httpx").isEnabledFor(logging.WARNING) is True
    finally:
        root.handlers.clear()
        root.handlers.extend(previous_handlers)
        root.setLevel(previous_root_level)
        for name, level in previous_http_levels.items():
            logging.getLogger(name).setLevel(level)
