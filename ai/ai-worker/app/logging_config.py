import json
import logging
from datetime import UTC, datetime

_CONTEXT_FIELDS = (
    "correlation_id",
    "request_id",
    "job_id",
    "worker_id",
    "session_id",
    "lesson_id",
    "material_id",
    "duration_ms",
    "error_code",
    "error_reason",
    "segment_count",
    "word_count",
    "invalid_segment_count",
    "zero_duration_word_count",
    "merged_word_count",
    "discarded_word_count",
    "fallback_mode",
)

_SENSITIVE_HTTP_LOGGERS = ("httpx", "httpcore")


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str) -> None:
        super().__init__()
        self._service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "service": self._service,
            "event": getattr(record, "event", record.getMessage()),
        }
        for field in _CONTEXT_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)


def configure_logging(service: str, level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter(service))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    for logger_name in _SENSITIVE_HTTP_LOGGERS:
        # httpx INFO access logs include the complete presigned URL, including its query signature.
        logging.getLogger(logger_name).setLevel(logging.WARNING)
