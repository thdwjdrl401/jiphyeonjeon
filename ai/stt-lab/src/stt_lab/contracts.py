from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_VALID_SPLITS = frozenset({"train", "dev", "test", "golden"})


@dataclass(frozen=True)
class EvaluationClip:
    clip_id: str
    audio_path: Path
    reference: str
    language: str
    speaker_id: str
    split: str
    terms: tuple[str, ...]
    consent: str
    sha256: str | None = None


def load_manifest(path: Path, *, require_audio: bool = True) -> tuple[EvaluationClip, ...]:
    manifest_path = path.resolve()
    if not manifest_path.is_file():
        raise ValueError(f"manifest does not exist: {path}")

    clips: list[EvaluationClip] = []
    seen_ids: set[str] = set()
    for line_number, raw_line in enumerate(
        manifest_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"manifest line {line_number} is not valid JSON") from exc
        clip = _parse_clip(value, manifest_path.parent, line_number)
        if clip.clip_id in seen_ids:
            raise ValueError(f"manifest contains duplicate clip id: {clip.clip_id}")
        if require_audio and not clip.audio_path.is_file():
            raise ValueError(f"audio does not exist for {clip.clip_id}: {clip.audio_path}")
        seen_ids.add(clip.clip_id)
        clips.append(clip)

    if not clips:
        raise ValueError("manifest must contain at least one clip")
    return tuple(clips)


def _parse_clip(value: Any, base_dir: Path, line_number: int) -> EvaluationClip:
    if not isinstance(value, dict):
        raise TypeError(f"manifest line {line_number} must be an object")
    allowed = {
        "id",
        "audioPath",
        "reference",
        "language",
        "speakerId",
        "split",
        "terms",
        "consent",
        "sha256",
    }
    extra = set(value) - allowed
    if extra:
        raise ValueError(f"manifest line {line_number} has unknown fields: {sorted(extra)}")

    clip_id = _required_text(value, "id", line_number)
    if not _SAFE_ID.fullmatch(clip_id):
        raise ValueError(f"manifest line {line_number} has an unsafe id")
    audio_value = _required_text(value, "audioPath", line_number)
    audio_path = Path(audio_value)
    if not audio_path.is_absolute():
        audio_path = (base_dir / audio_path).resolve()
    split = _required_text(value, "split", line_number)
    if split not in _VALID_SPLITS:
        raise ValueError(f"manifest line {line_number} has an invalid split: {split}")

    terms_value = value.get("terms", [])
    if not isinstance(terms_value, list) or not all(
        isinstance(term, str) and term.strip() for term in terms_value
    ):
        raise ValueError(f"manifest line {line_number} terms must be non-blank strings")
    sha256 = value.get("sha256")
    if sha256 is not None and (
        not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256)
    ):
        raise ValueError(f"manifest line {line_number} sha256 must be lowercase hex")

    return EvaluationClip(
        clip_id=clip_id,
        audio_path=audio_path,
        reference=_required_text(value, "reference", line_number),
        language=_required_text(value, "language", line_number),
        speaker_id=_required_text(value, "speakerId", line_number),
        split=split,
        terms=tuple(term.strip() for term in terms_value),
        consent=_required_text(value, "consent", line_number),
        sha256=sha256,
    )


def _required_text(value: dict[str, Any], field: str, line_number: int) -> str:
    field_value = value.get(field)
    if not isinstance(field_value, str) or not field_value.strip():
        raise ValueError(f"manifest line {line_number} field {field} must be non-blank")
    return field_value.strip()
