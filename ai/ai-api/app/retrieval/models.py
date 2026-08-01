from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True, slots=True)
class MaterialChunkHit:
    """One curriculum-scoped chunk from an active PPTX material version (ADR-0005)."""

    chunk_id: int
    material_version_id: int
    lesson_id: UUID
    curriculum_id: UUID
    material_id: UUID
    material_version: int
    page: int
    chunk_index: int
    text: str
    vector_score: float
    lexical_score: float
    score: float
