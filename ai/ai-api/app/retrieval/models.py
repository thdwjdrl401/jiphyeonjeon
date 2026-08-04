from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True, slots=True)
class MaterialChunkHit:
    """One curriculum-scoped chunk from an active PPTX material version (ADR-0007)."""

    chunk_id: int
    material_version_id: int
    # None for curriculum-scoped materials, which have no lesson (docs/ai/CONTRACT.md §9).
    lesson_id: UUID | None
    curriculum_id: UUID
    material_id: UUID
    material_version: int
    page: int
    chunk_index: int
    text: str
    vector_score: float
    lexical_score: float
    score: float


@dataclass(frozen=True, slots=True)
class AnnotationHighlightHit:
    """One instructor highlight snapshot indexed as evidence (ADR-0043 §1).

    Scores are None for recent-window results, which are selected by time rather than
    similarity (ADR-0043 §5) and therefore have nothing to rank.
    """

    highlight_id: UUID
    curriculum_id: UUID
    lesson_id: UUID
    session_id: UUID
    session_ms: int
    text: str
    vector_score: float | None = None
    lexical_score: float | None = None
    score: float | None = None


@dataclass(frozen=True, slots=True)
class SessionTimeCutoff:
    """Hides snapshots the asker could not have seen yet (ADR-0043 §4).

    Applies to one session only: snapshots from other (already finished) sessions are wholly
    in the past. Live answering passes no cutoff — an indexed snapshot is past by definition.
    """

    session_id: UUID
    max_session_ms: int
