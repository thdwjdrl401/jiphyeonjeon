from __future__ import annotations

import re
from dataclasses import dataclass

_DUAL_TRANSCRIPTION = re.compile(r"\(([^()]*)\)/\(([^()]*)\)")
_EXTRA_LEFT_CLOSE = re.compile(r"\(([^()]*)\)\)/\(([^()]*)\)")
_MISSING_LEFT_OPEN = re.compile(r"^([A-Za-z][A-Za-z0-9_.+-]*)\)/\(([^()]*)\)")
_MISSING_RIGHT_CLOSE = re.compile(r"\(([^()]*)\)/\(([^()\s]+)(?=\s|$)")


@dataclass(frozen=True)
class TranscriptionSegment:
    alternatives: tuple[str, ...]


def parse_aihub_transcription(value: str) -> tuple[TranscriptionSegment, ...]:
    repaired = _repair_known_markup_errors(value)
    segments: list[TranscriptionSegment] = []
    cursor = 0
    for match in _DUAL_TRANSCRIPTION.finditer(repaired):
        if match.start() > cursor:
            segments.append(TranscriptionSegment((repaired[cursor : match.start()],)))
        segments.append(TranscriptionSegment((match.group(1), match.group(2))))
        cursor = match.end()
    if cursor < len(repaired):
        segments.append(TranscriptionSegment((repaired[cursor:],)))
    if ")/(" in "".join(segment.alternatives[0] for segment in segments):
        raise ValueError("unsupported AI Hub dual-transcription markup")
    return tuple(segments) or (TranscriptionSegment(("",)),)


def canonical_transcription(value: str, *, pronunciation: bool = False) -> str:
    selected = []
    for segment in parse_aihub_transcription(value):
        index = 1 if pronunciation and len(segment.alternatives) > 1 else 0
        selected.append(segment.alternatives[index])
    return " ".join("".join(selected).split())


def transcription_alternative_count(value: str) -> int:
    return sum(len(segment.alternatives) > 1 for segment in parse_aihub_transcription(value))


def _repair_known_markup_errors(value: str) -> str:
    repaired = _EXTRA_LEFT_CLOSE.sub(r"(\1)/(\2)", value)
    repaired = _MISSING_LEFT_OPEN.sub(r"(\1)/(\2)", repaired)
    return _MISSING_RIGHT_CLOSE.sub(r"(\1)/(\2)", repaired)
