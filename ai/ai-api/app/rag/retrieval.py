from __future__ import annotations

import asyncio
from collections.abc import Iterable, Sequence
from typing import Protocol
from uuid import UUID

from app.captions import CaptionContextResult
from app.rag.models import (
    AnnotationSource,
    AnnotationSourceV2,
    CaptionSource,
    CaptionSourceV2,
    PptxSource,
    PptxSourceV2,
    RagAnswerRequest,
    RagAnswerRequestV2,
    RetrievedEvidence,
    RetrievedEvidenceV2,
    RetrievalResult,
    RetrievalResultV2,
)
from app.retrieval import AnnotationSnapshotHit, MaterialChunkHit, SessionTimeCutoff


class MaterialRetrievalPort(Protocol):
    async def retrieve(
        self,
        *,
        curriculum_id: UUID,
        query_text: str,
        top_k: int,
    ) -> tuple[MaterialChunkHit, ...]: ...


class AnnotationRetrievalPort(Protocol):
    async def retrieve(
        self,
        *,
        curriculum_id: UUID,
        query_text: str,
        top_k: int,
        cutoff: SessionTimeCutoff | None,
    ) -> tuple[AnnotationSnapshotHit, ...]: ...

    async def recent(
        self,
        *,
        session_id: UUID,
        limit: int,
        cutoff: SessionTimeCutoff | None,
    ) -> tuple[AnnotationSnapshotHit, ...]: ...


class CaptionContextPort(Protocol):
    def query(self, session_id: str, context_time_ms: int) -> CaptionContextResult: ...


async def _gather_annotation_hits(
    annotations: AnnotationRetrievalPort,
    *,
    curriculum_id: UUID,
    session_id: UUID,
    question: str,
    top_k: int,
    window_size: int,
    cutoff: SessionTimeCutoff | None,
) -> tuple[AnnotationSnapshotHit, ...]:
    """Two reads, one merged list (ADR-0043 §5).

    Similarity answers "what did the instructor highlight about X"; the recent window answers
    "what did the instructor just highlight", which no amount of semantic search can find
    because a time deixis like "아까" has no direction in embedding space. The window comes
    first so the most recent highlights survive when both return the same snapshot.
    """

    searched, window = await asyncio.gather(
        annotations.retrieve(
            curriculum_id=curriculum_id, query_text=question, top_k=top_k, cutoff=cutoff
        ),
        annotations.recent(session_id=session_id, limit=window_size, cutoff=cutoff),
    )
    return _dedupe_by_snapshot(window, searched)


def _dedupe_by_snapshot(
    *groups: Iterable[AnnotationSnapshotHit],
) -> tuple[AnnotationSnapshotHit, ...]:
    seen: set[UUID] = set()
    merged: list[AnnotationSnapshotHit] = []
    for group in groups:
        for hit in group:
            if hit.snapshot_id in seen:
                continue
            seen.add(hit.snapshot_id)
            merged.append(hit)
    return tuple(merged)


class CombinedEvidenceRetriever:
    """Combine active lesson PPTX hits with the latest caption attempt context."""

    def __init__(
        self,
        materials: MaterialRetrievalPort,
        captions: CaptionContextPort,
        *,
        annotations: AnnotationRetrievalPort | None = None,
        annotation_top_k: int = 2,
        annotation_window_size: int = 5,
        material_top_k: int = 3,
        material_vector_threshold: float = 0.25,
        material_lexical_threshold: float = 0.0,
        caption_max_items: int = 32,
        caption_max_chars: int = 20_000,
        excerpt_max_chars: int = 300,
    ) -> None:
        if not 1 <= annotation_top_k <= 50:
            raise ValueError("annotation_top_k must be between 1 and 50")
        if not 1 <= annotation_window_size <= 50:
            raise ValueError("annotation_window_size must be between 1 and 50")
        if not 1 <= material_top_k <= 50:
            raise ValueError("material_top_k must be between 1 and 50")
        if not 0 <= material_vector_threshold <= 1:
            raise ValueError("material_vector_threshold must be between zero and one")
        if not 0 <= material_lexical_threshold <= 1:
            raise ValueError("material_lexical_threshold must be between zero and one")
        if caption_max_items <= 0:
            raise ValueError("caption_max_items must be positive")
        if not 1 <= caption_max_chars <= 50_000:
            raise ValueError("caption_max_chars must be between 1 and 50000")
        if excerpt_max_chars <= 0:
            raise ValueError("excerpt_max_chars must be positive")
        self._materials = materials
        self._captions = captions
        self._annotations = annotations
        self._annotation_top_k = annotation_top_k
        self._annotation_window_size = annotation_window_size
        self._material_top_k = material_top_k
        self._material_vector_threshold = material_vector_threshold
        self._material_lexical_threshold = material_lexical_threshold
        self._caption_max_items = caption_max_items
        self._caption_max_chars = caption_max_chars
        self._excerpt_max_chars = excerpt_max_chars

    async def retrieve(self, request: RagAnswerRequest) -> RetrievalResult:
        # Live needs no time cutoff: a snapshot only exists in the index once its job ran, so
        # anything found is already in the asker's past (ADR-0043 §4).
        material_hits, annotation_hits = await self._search(request)
        evidence = [
            RetrievedEvidence(
                lesson_id=hit.lesson_id,
                curriculum_id=hit.curriculum_id,
                content=hit.text,
                source=PptxSource(
                    materialId=hit.material_id,
                    page=hit.page,
                    excerpt=_truncate(hit.text, self._excerpt_max_chars),
                ),
            )
            for hit in material_hits
            if (
                hit.vector_score >= self._material_vector_threshold
                or hit.lexical_score > self._material_lexical_threshold
            )
        ]

        evidence.extend(
            RetrievedEvidence(
                lesson_id=hit.lesson_id,
                curriculum_id=hit.curriculum_id,
                content=hit.text,
                source=AnnotationSource(
                    snapshotId=hit.snapshot_id,
                    sessionId=str(hit.session_id),
                    sessionMs=hit.session_ms,
                    excerpt=_truncate(hit.text, self._excerpt_max_chars),
                ),
            )
            for hit in annotation_hits
        )

        context = self._captions.query(request.sessionId, request.contextTimeMs)
        caption_evidence = self._build_caption_evidence(context)
        if caption_evidence is not None:
            evidence.append(caption_evidence)

        return RetrievalResult(sufficient=bool(evidence), evidence=tuple(evidence))

    async def _search(
        self, request: RagAnswerRequest
    ) -> tuple[Sequence[MaterialChunkHit], Sequence[AnnotationSnapshotHit]]:
        material_search = self._materials.retrieve(
            curriculum_id=request.curriculumId,
            query_text=request.question,
            top_k=self._material_top_k,
        )
        if self._annotations is None:
            return await material_search, ()
        return await asyncio.gather(
            material_search,
            _gather_annotation_hits(
                self._annotations,
                curriculum_id=request.curriculumId,
                session_id=UUID(request.sessionId),
                question=request.question,
                top_k=self._annotation_top_k,
                window_size=self._annotation_window_size,
                cutoff=None,
            ),
        )

    def _build_caption_evidence(
        self,
        context: CaptionContextResult,
    ) -> RetrievedEvidence | None:
        if not context.available:
            return None
        if context.lesson_id is None or context.stt_session_id is None:
            raise ValueError("available caption context must carry lesson and attempt scope")

        selected = []
        selected_chars = 0
        for item in reversed(context.items):
            item_chars = len(item.text)
            if (
                len(selected) >= self._caption_max_items
                or selected_chars + item_chars > self._caption_max_chars
            ):
                break
            selected.append(item)
            selected_chars += item_chars
        if not selected:
            return None
        selected.reverse()

        content = "".join(item.text for item in selected)
        return RetrievedEvidence(
            lesson_id=context.lesson_id,
            content=content,
            source=CaptionSource(
                sessionId=context.session_id,
                sttSessionId=context.stt_session_id,
                startMs=selected[0].stream_elapsed_ms,
                endMs=selected[-1].stream_elapsed_ms,
                excerpt=_truncate(content, self._excerpt_max_chars),
            ),
        )


def _truncate(text: str, max_chars: int) -> str:
    return text[:max_chars]


class ReplayEvidenceRetriever:
    """Replay (v2) counterpart of CombinedEvidenceRetriever.

    PPTX search reuses the same MaterialRetrievalPort/threshold logic. Caption evidence is
    never re-queried here: Spring already resolved and time-converted it (ADR-0037), so this
    class only merges the request's context.captions into a single CaptionSourceV2 evidence —
    ADR-0037 requires at most one CAPTION source per answer.
    """

    def __init__(
        self,
        materials: MaterialRetrievalPort,
        *,
        annotations: AnnotationRetrievalPort | None = None,
        annotation_top_k: int = 2,
        annotation_window_size: int = 5,
        material_top_k: int = 3,
        material_vector_threshold: float = 0.25,
        material_lexical_threshold: float = 0.0,
        excerpt_max_chars: int = 300,
    ) -> None:
        if not 1 <= annotation_top_k <= 50:
            raise ValueError("annotation_top_k must be between 1 and 50")
        if not 1 <= annotation_window_size <= 50:
            raise ValueError("annotation_window_size must be between 1 and 50")
        if not 1 <= material_top_k <= 50:
            raise ValueError("material_top_k must be between 1 and 50")
        if not 0 <= material_vector_threshold <= 1:
            raise ValueError("material_vector_threshold must be between zero and one")
        if not 0 <= material_lexical_threshold <= 1:
            raise ValueError("material_lexical_threshold must be between zero and one")
        if excerpt_max_chars <= 0:
            raise ValueError("excerpt_max_chars must be positive")
        self._materials = materials
        self._annotations = annotations
        self._annotation_top_k = annotation_top_k
        self._annotation_window_size = annotation_window_size
        self._material_top_k = material_top_k
        self._material_vector_threshold = material_vector_threshold
        self._material_lexical_threshold = material_lexical_threshold
        self._excerpt_max_chars = excerpt_max_chars

    async def retrieve(self, request: RagAnswerRequestV2) -> RetrievalResultV2:
        material_hits, annotation_hits = await self._search(request)
        evidence = [
            RetrievedEvidenceV2(
                lesson_id=hit.lesson_id,
                curriculum_id=hit.curriculum_id,
                content=hit.text,
                source=PptxSourceV2(
                    materialId=hit.material_id,
                    page=hit.page,
                    excerpt=_truncate(hit.text, self._excerpt_max_chars),
                ),
            )
            for hit in material_hits
            if (
                hit.vector_score >= self._material_vector_threshold
                or hit.lexical_score > self._material_lexical_threshold
            )
        ]

        evidence.extend(
            RetrievedEvidenceV2(
                lesson_id=hit.lesson_id,
                curriculum_id=hit.curriculum_id,
                content=hit.text,
                source=AnnotationSourceV2(
                    snapshotId=hit.snapshot_id,
                    sessionId=str(hit.session_id),
                    sessionMs=hit.session_ms,
                    excerpt=_truncate(hit.text, self._excerpt_max_chars),
                ),
            )
            for hit in annotation_hits
        )

        caption_evidence = self._build_caption_evidence(request)
        if caption_evidence is not None:
            evidence.append(caption_evidence)

        return RetrievalResultV2(sufficient=bool(evidence), evidence=tuple(evidence))

    async def _search(
        self, request: RagAnswerRequestV2
    ) -> tuple[Sequence[MaterialChunkHit], Sequence[AnnotationSnapshotHit]]:
        material_search = self._materials.retrieve(
            curriculum_id=request.curriculumId,
            query_text=request.question,
            top_k=self._material_top_k,
        )
        if self._annotations is None:
            return await material_search, ()
        # A highlight made after the question was asked cannot be evidence for it, but only
        # within this session — other sessions already finished (ADR-0043 §4).
        session_id = UUID(request.sessionId)
        return await asyncio.gather(
            material_search,
            _gather_annotation_hits(
                self._annotations,
                curriculum_id=request.curriculumId,
                session_id=session_id,
                question=request.question,
                top_k=self._annotation_top_k,
                window_size=self._annotation_window_size,
                cutoff=SessionTimeCutoff(
                    session_id=session_id,
                    max_session_ms=request.context.questionSessionMs,
                ),
            ),
        )

    def _build_caption_evidence(self, request: RagAnswerRequestV2) -> RetrievedEvidenceV2 | None:
        items = request.context.captions
        if not items:
            return None

        content = "".join(item.text for item in items)
        start_session_ms = min(item.startSessionMs for item in items)
        end_session_ms = max(item.endSessionMs for item in items)

        return RetrievedEvidenceV2(
            lesson_id=request.lessonId,
            content=content,
            source=CaptionSourceV2(
                sessionId=request.sessionId,
                startSessionMs=start_session_ms,
                endSessionMs=end_session_ms,
                excerpt=_truncate(content, self._excerpt_max_chars),
            ),
        )
