from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class WindowFlushReason(StrEnum):
    STRONG_BOUNDARY = "strong_boundary"
    TARGET_REACHED = "target_reached"
    FORCED_THRESHOLD = "forced_threshold"
    ATTEMPT_CHANGED = "attempt_changed"
    COMPLETED = "completed"


@dataclass(frozen=True, slots=True)
class LectureNoteWindow:
    session_id: str
    lesson_id: str
    stt_session_id: str
    start_sequence: int
    end_sequence: int
    start_stream_elapsed_ms: int
    end_stream_elapsed_ms: int
    text: str
    previous_context: str
    flush_reason: WindowFlushReason
