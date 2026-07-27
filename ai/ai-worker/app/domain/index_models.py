from collections.abc import Sequence
from dataclasses import dataclass
import math
import re
from uuid import UUID


BGE_M3_DIMENSIONS = 1024
BGE_M3_MODEL = "BAAI/bge-m3"
_PINNED_REVISION = re.compile(r"^[0-9a-f]{7,64}$")


def _require_text(value: str, field: str) -> None:
    if not value or not value.strip():
        raise ValueError(f"{field} must not be empty")


@dataclass(frozen=True, slots=True)
class ChunkRecord:
    chunk_index: int
    page: int
    text: str
    content_hash: str
    embedding: Sequence[float]

    def __post_init__(self) -> None:
        if self.chunk_index < 0:
            raise ValueError("chunk_index must be non-negative")
        if self.page < 1:
            raise ValueError("page must be positive")
        _require_text(self.text, "text")
        _require_text(self.content_hash, "content_hash")

        values = tuple(float(value) for value in self.embedding)
        if len(values) != BGE_M3_DIMENSIONS:
            raise ValueError(f"BGE-M3 embeddings must contain exactly {BGE_M3_DIMENSIONS} values")
        norm = math.hypot(*values)
        if (
            not all(math.isfinite(value) for value in values)
            or not math.isfinite(norm)
            or norm == 0
        ):
            raise ValueError("embedding must be a finite non-zero vector")
        object.__setattr__(self, "embedding", values)


@dataclass(frozen=True, slots=True)
class StagedMaterial:
    job_id: str
    idempotency_key: str
    tenant_id: str
    curriculum_id: UUID
    lesson_id: UUID
    material_id: UUID
    material_version: int
    source_bucket: str
    source_object_key: str
    correlation_id: str
    chunk_strategy: str
    model_name: str
    model_revision: str

    def __post_init__(self) -> None:
        for field in (
            "job_id",
            "idempotency_key",
            "tenant_id",
            "source_bucket",
            "source_object_key",
            "correlation_id",
            "chunk_strategy",
        ):
            _require_text(getattr(self, field), field)
        for field in ("curriculum_id", "lesson_id", "material_id"):
            if not isinstance(getattr(self, field), UUID):
                raise ValueError(f"{field} must be a UUID")
        if self.material_version < 1:
            raise ValueError("material_version must be positive")
        if self.model_name != BGE_M3_MODEL:
            raise ValueError(f"model_name must be {BGE_M3_MODEL}")
        if not _PINNED_REVISION.fullmatch(self.model_revision):
            raise ValueError("model_revision must be a pinned hexadecimal commit revision")
