from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

MAX_JOB_METADATA_BYTES = 4096
_FIELDS = frozenset({"contractVersion", "sessionId", "lessonId", "correlationId"})
_SAFE_CORRELATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class InvalidJobMetadataError(ValueError):
    """The LiveKit dispatch metadata does not match the AI-side v1 proposal."""


def _reject_constant(value: str) -> None:
    raise InvalidJobMetadataError(f"non-finite JSON number is not allowed: {value}")


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidJobMetadataError(f"duplicate metadata field: {key}")
        result[key] = value
    return result


def _canonical_uuid(value: object, field_name: str) -> UUID:
    if not isinstance(value, str):
        raise InvalidJobMetadataError(f"{field_name} must be a canonical UUID string")
    try:
        parsed = UUID(value)
    except (AttributeError, ValueError) as exc:
        raise InvalidJobMetadataError(f"{field_name} must be a canonical UUID string") from exc
    if str(parsed) != value:
        raise InvalidJobMetadataError(f"{field_name} must be a canonical UUID string")
    return parsed


@dataclass(frozen=True, slots=True)
class JobMetadata:
    contract_version: str
    session_id: UUID
    lesson_id: UUID
    correlation_id: str

    @classmethod
    def from_values(
        cls,
        *,
        session_id: str,
        lesson_id: str,
        correlation_id: str,
    ) -> JobMetadata:
        return cls.parse(
            json.dumps(
                {
                    "contractVersion": "1",
                    "sessionId": session_id,
                    "lessonId": lesson_id,
                    "correlationId": correlation_id,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )

    def to_json(self) -> str:
        return json.dumps(
            {
                "contractVersion": self.contract_version,
                "sessionId": str(self.session_id),
                "lessonId": str(self.lesson_id),
                "correlationId": self.correlation_id,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

    @classmethod
    def parse(cls, raw: str) -> JobMetadata:
        if not isinstance(raw, str):
            raise InvalidJobMetadataError("job metadata must be a JSON string")
        try:
            raw_size = len(raw.encode("utf-8"))
        except UnicodeEncodeError as exc:
            raise InvalidJobMetadataError("job metadata must be valid UTF-8") from exc
        if raw_size > MAX_JOB_METADATA_BYTES:
            raise InvalidJobMetadataError(
                f"job metadata must not exceed {MAX_JOB_METADATA_BYTES} UTF-8 bytes"
            )

        try:
            value = json.loads(
                raw,
                object_pairs_hook=_object_without_duplicate_keys,
                parse_constant=_reject_constant,
            )
        except InvalidJobMetadataError:
            raise
        except (TypeError, json.JSONDecodeError) as exc:
            raise InvalidJobMetadataError("job metadata must be valid JSON") from exc
        if not isinstance(value, dict):
            raise InvalidJobMetadataError("job metadata must be a JSON object")

        actual_fields = frozenset(value)
        missing = sorted(_FIELDS - actual_fields)
        unknown = sorted(actual_fields - _FIELDS)
        if missing:
            raise InvalidJobMetadataError(f"missing metadata fields: {', '.join(missing)}")
        if unknown:
            raise InvalidJobMetadataError(f"unknown metadata fields: {', '.join(unknown)}")

        if value["contractVersion"] != "1":
            raise InvalidJobMetadataError("contractVersion must be '1'")
        correlation_id = value["correlationId"]
        if not isinstance(correlation_id, str) or not _SAFE_CORRELATION_ID.fullmatch(
            correlation_id
        ):
            raise InvalidJobMetadataError("correlationId must be a 1-128 character safe identifier")

        return cls(
            contract_version="1",
            session_id=_canonical_uuid(value["sessionId"], "sessionId"),
            lesson_id=_canonical_uuid(value["lessonId"], "lessonId"),
            correlation_id=correlation_id,
        )
