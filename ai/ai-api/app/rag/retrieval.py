from __future__ import annotations

from typing import Protocol
from uuid import UUID

from app.captions import CaptionContextResult
from app.rag.models import (
    CaptionSource,
    PptxSource,
    RagAnswerRequest,
    RetrievedEvidence,
    RetrievalResult,
)
from app.retrieval import MaterialChunkHit


class MaterialRetrievalPort(Protocol):
    async def retrieve(
        self,
        *,
        lesson_id: UUID,
        query_text: str,
        top_k: int,
    ) -> tuple[MaterialChunkHit, ...]: ...


class CaptionContextPort(Protocol):
    def query(self, session_id: str, context_time_ms: int) -> CaptionContextResult: ...


class CombinedEvidenceRetriever:
    """Combine active lesson PPTX hits with the latest caption attempt context."""

    def __init__(
        self,
        materials: MaterialRetrievalPort,
        captions: CaptionContextPort,
        *,
        material_top_k: int = 3,
        material_vector_threshold: float = 0.25,
        material_lexical_threshold: float = 0.0,
        caption_max_items: int = 32,
        caption_max_chars: int = 20_000,
    ) -> None:
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
        self._materials = materials
        self._captions = captions
        self._material_top_k = material_top_k
        self._material_vector_threshold = material_vector_threshold
        self._material_lexical_threshold = material_lexical_threshold
        self._caption_max_items = caption_max_items
        self._caption_max_chars = caption_max_chars

    async def retrieve(self, request: RagAnswerRequest) -> RetrievalResult:
        material_hits = await self._materials.retrieve(
            lesson_id=request.lessonId,
            query_text=request.question,
            top_k=self._material_top_k,
        )
        evidence = [
            RetrievedEvidence(
                lesson_id=hit.lesson_id,
                content=hit.text,
                source=PptxSource(materialId=hit.material_id, page=hit.page),
            )
            for hit in material_hits
            if (
                hit.vector_score >= self._material_vector_threshold
                or hit.lexical_score > self._material_lexical_threshold
            )
        ]

        context = self._captions.query(request.sessionId, request.contextTimeMs)
        caption_evidence = self._build_caption_evidence(context)
        if caption_evidence is not None:
            evidence.append(caption_evidence)

        return RetrievalResult(sufficient=bool(evidence), evidence=tuple(evidence))

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

        return RetrievedEvidence(
            lesson_id=context.lesson_id,
            content="".join(item.text for item in selected),
            source=CaptionSource(
                sessionId=context.session_id,
                sttSessionId=context.stt_session_id,
                startMs=selected[0].stream_elapsed_ms,
                endMs=selected[-1].stream_elapsed_ms,
            ),
        )
