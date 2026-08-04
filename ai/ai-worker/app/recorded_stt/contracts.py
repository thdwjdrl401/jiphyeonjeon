from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class RecordedSttJob(_WireModel):
    task_type: Literal["RECORDED_STT"] = Field(alias="taskType")
    job_id: UUID = Field(alias="jobId")
    recorded_video_id: UUID = Field(alias="recordedVideoId")
    lesson_id: UUID = Field(alias="lessonId")
    source_asset_id: UUID = Field(alias="sourceAssetId")
    language: Literal["ko"]
    contract_version: Literal[1] = Field(alias="contractVersion")

    @model_validator(mode="before")
    @classmethod
    def reject_python_field_names(cls, value: object) -> object:
        if isinstance(value, Mapping):
            for field_name, field in cls.model_fields.items():
                if field.alias and field.alias != field_name and field_name in value:
                    raise ValueError("wire fields must use camelCase aliases")
        return value


class CompletedChunk(_WireModel):
    chunk_index: int = Field(alias="chunkIndex", ge=0)
    source_sha256: str = Field(alias="sourceSha256", pattern=r"^[0-9a-f]{64}$")
    segment_count: int = Field(alias="segmentCount", ge=0)


class SttProgress(_WireModel):
    job_id: UUID = Field(alias="jobId")
    status: Literal["PENDING", "DISPATCHED", "RUNNING", "SUCCEEDED", "FAILED"]
    terminal: bool
    source_duration_ms: int | None = Field(default=None, alias="sourceDurationMs", ge=0)
    completed_chunks: tuple[CompletedChunk, ...] = Field(alias="completedChunks")


class CaptionSegment(_WireModel):
    local_segment_index: int = Field(alias="localSegmentIndex", ge=0)
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", gt=0)
    text: str = Field(min_length=1, max_length=4000)


class ChunkResult(_WireModel):
    event_id: str = Field(alias="eventId", min_length=1, max_length=255)
    source_start_ms: int = Field(alias="sourceStartMs", ge=0)
    source_end_ms: int = Field(alias="sourceEndMs", gt=0)
    source_sha256: str = Field(alias="sourceSha256", pattern=r"^[0-9a-f]{64}$")
    model: Literal["whisper-1"]
    language: Literal["ko"]
    segments: tuple[CaptionSegment, ...]

    def raw_body(self) -> bytes:
        return json.dumps(
            self.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")


def parse_recorded_stt_job(body: bytes) -> RecordedSttJob:
    if not body or len(body) > 64 * 1024:
        raise ValueError("recorded STT job body must be between 1 byte and 64 KiB")
    return RecordedSttJob.model_validate_json(body)
