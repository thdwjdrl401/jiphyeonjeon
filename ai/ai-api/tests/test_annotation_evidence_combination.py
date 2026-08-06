"""Annotation evidence merged into both RAG paths (ADR-0043 §4-5)."""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest

from app.rag import (
    AnnotationSource,
    AnnotationSourceV2,
    CombinedEvidenceRetriever,
    RagAnswerRequest,
    RagAnswerRequestV2,
    ReplayEvidenceRetriever,
)
from app.retrieval import AnnotationHighlightHit, MaterialChunkHit, SessionTimeCutoff


LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
CURRICULUM_ID = UUID("44444444-4444-4444-8444-444444444444")
MATERIAL_ID = UUID("22222222-2222-4222-8222-222222222222")
SESSION_ID = "33333333-3333-4333-8333-333333333333"


def _material_hit(text: str = "자료 근거") -> MaterialChunkHit:
    return MaterialChunkHit(
        chunk_id=1,
        material_version_id=1,
        lesson_id=LESSON_ID,
        curriculum_id=CURRICULUM_ID,
        material_id=MATERIAL_ID,
        material_version=1,
        page=4,
        chunk_index=0,
        text=text,
        vector_score=0.9,
        lexical_score=0.0,
        score=1.0,
    )


def _annotation_hit(
    highlight_id: UUID, *, text: str = "B+ tree 노드 분할 조건", session_ms: int = 725_300
) -> AnnotationHighlightHit:
    return AnnotationHighlightHit(
        highlight_id=highlight_id,
        curriculum_id=CURRICULUM_ID,
        lesson_id=LESSON_ID,
        session_id=UUID(SESSION_ID),
        session_ms=session_ms,
        text=text,
    )


class Materials:
    def __init__(self, hits: tuple[MaterialChunkHit, ...] = ()) -> None:
        self.hits = hits

    async def retrieve(self, *, curriculum_id, query_text, top_k):
        return self.hits


class Annotations:
    def __init__(
        self,
        searched: tuple[AnnotationHighlightHit, ...] = (),
        window: tuple[AnnotationHighlightHit, ...] = (),
    ) -> None:
        self.searched = searched
        self.window = window
        self.search_calls: list[dict] = []
        self.window_calls: list[dict] = []

    async def retrieve(self, *, curriculum_id, session_id, query_text, top_k, cutoff):
        self.search_calls.append(
            {
                "curriculum_id": curriculum_id,
                "session_id": session_id,
                "query_text": query_text,
                "top_k": top_k,
                "cutoff": cutoff,
            }
        )
        return self.searched

    async def recent(self, *, session_id, limit, cutoff):
        self.window_calls.append({"session_id": session_id, "limit": limit, "cutoff": cutoff})
        return self.window


class Captions:
    def query(self, session_id, context_time_ms):
        return _EMPTY_CONTEXT


class _EmptyContext:
    available = False
    lesson_id = None
    stt_session_id = None
    session_id = SESSION_ID
    items = ()


_EMPTY_CONTEXT = _EmptyContext()


def _live_request(question: str = "아까 강조하신 게 뭐였지?") -> RagAnswerRequest:
    return RagAnswerRequest(
        requestId="request-1",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question=question,
        contextTimeMs=615_000,
        issuedAtMs=1_785_120_000_000,
    )


def _replay_request(question_session_ms: int = 735_000) -> RagAnswerRequestV2:
    return RagAnswerRequestV2(
        requestId="request-1",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="아까 강조하신 게 뭐였지?",
        context={"mode": "REPLAY", "questionSessionMs": question_session_ms, "captions": []},
        issuedAtMs=1_785_450_000_000,
    )


def test_live_answers_a_time_question_from_the_recent_window_alone() -> None:
    """No material matched and similarity found nothing — the window is what makes
    "아까 강조하신 게" answerable at all."""
    highlight_id = uuid4()
    annotations = Annotations(searched=(), window=(_annotation_hit(highlight_id),))
    retriever = CombinedEvidenceRetriever(Materials(), Captions(), annotations=annotations)

    result = asyncio.run(retriever.retrieve(_live_request()))

    assert result.sufficient is True
    source = result.evidence[0].source
    assert isinstance(source, AnnotationSource)
    assert source.highlightId == highlight_id
    assert source.sessionMs == 725_300
    assert source.excerpt == "B+ tree 노드 분할 조건"


def test_live_merges_annotation_evidence_after_material_evidence() -> None:
    annotations = Annotations(searched=(_annotation_hit(uuid4()),))
    retriever = CombinedEvidenceRetriever(
        Materials((_material_hit(),)), Captions(), annotations=annotations
    )

    result = asyncio.run(retriever.retrieve(_live_request()))

    assert [source.source.type for source in result.evidence] == ["PPTX", "ANNOTATION"]


def test_a_snapshot_found_by_both_reads_is_cited_once() -> None:
    highlight_id = uuid4()
    annotations = Annotations(
        searched=(_annotation_hit(highlight_id),), window=(_annotation_hit(highlight_id),)
    )
    retriever = CombinedEvidenceRetriever(Materials(), Captions(), annotations=annotations)

    result = asyncio.run(retriever.retrieve(_live_request()))

    assert len(result.evidence) == 1


def test_live_search_uses_no_time_cutoff() -> None:
    """An indexed snapshot is already in the past, and live contextTimeMs is attempt-local so
    it cannot be compared with sessionMs at all (ADR-0043 §4)."""
    annotations = Annotations()
    retriever = CombinedEvidenceRetriever(Materials(), Captions(), annotations=annotations)

    asyncio.run(retriever.retrieve(_live_request()))

    assert annotations.search_calls[0]["cutoff"] is None
    assert annotations.window_calls[0]["cutoff"] is None
    assert annotations.window_calls[0]["session_id"] == UUID(SESSION_ID)


def test_both_reads_are_scoped_to_the_asker_session() -> None:
    """The similarity read must carry the asker's session too (ADR-0089) — before that it
    searched the whole curriculum and dragged old sessions' highlights into live answers."""
    annotations = Annotations()
    retriever = CombinedEvidenceRetriever(Materials(), Captions(), annotations=annotations)

    asyncio.run(retriever.retrieve(_live_request()))

    assert annotations.search_calls[0]["session_id"] == UUID(SESSION_ID)
    assert annotations.window_calls[0]["session_id"] == UUID(SESSION_ID)


def _scored_hit(highlight_id: UUID, vector_score: float) -> AnnotationHighlightHit:
    return AnnotationHighlightHit(
        highlight_id=highlight_id,
        curriculum_id=CURRICULUM_ID,
        lesson_id=LESSON_ID,
        session_id=UUID(SESSION_ID),
        session_ms=725_300,
        text="B+ tree 노드 분할 조건",
        vector_score=vector_score,
        lexical_score=0.0,
        score=1.0,
    )


def test_searched_hits_below_the_vector_threshold_are_dropped_in_both_paths() -> None:
    """Without this gate the top-k best-of-nothing hits entered every answer and the same
    unrelated highlight repeated across questions (ADR-0089)."""
    relevant, irrelevant = uuid4(), uuid4()
    searched = (_scored_hit(relevant, 0.85), _scored_hit(irrelevant, 0.31))

    live = CombinedEvidenceRetriever(
        Materials(), Captions(), annotations=Annotations(searched=searched)
    )
    replay = ReplayEvidenceRetriever(Materials(), annotations=Annotations(searched=searched))

    live_ids = [e.source.highlightId for e in asyncio.run(live.retrieve(_live_request())).evidence]
    replay_ids = [
        e.source.highlightId for e in asyncio.run(replay.retrieve(_replay_request())).evidence
    ]

    assert live_ids == [relevant]
    assert replay_ids == [relevant]


def test_recent_window_hits_bypass_the_vector_threshold() -> None:
    """Window hits are selected by time and carry no score — a threshold of 1.0 must still
    let them through, or "아까 강조하신 게" questions lose their only evidence."""
    highlight_id = uuid4()
    live = CombinedEvidenceRetriever(
        Materials(),
        Captions(),
        annotations=Annotations(window=(_annotation_hit(highlight_id),)),
        annotation_vector_threshold=1.0,
    )

    result = asyncio.run(live.retrieve(_live_request()))

    assert [e.source.highlightId for e in result.evidence] == [highlight_id]


def test_replay_passes_the_question_moment_as_the_cutoff_to_both_reads() -> None:
    annotations = Annotations()
    retriever = ReplayEvidenceRetriever(Materials(), annotations=annotations)

    asyncio.run(retriever.retrieve(_replay_request(735_000)))

    expected = SessionTimeCutoff(session_id=UUID(SESSION_ID), max_session_ms=735_000)
    assert annotations.search_calls[0]["cutoff"] == expected
    assert annotations.window_calls[0]["cutoff"] == expected


def test_replay_annotation_source_carries_a_mandatory_excerpt() -> None:
    highlight_id = uuid4()
    annotations = Annotations(window=(_annotation_hit(highlight_id),))
    retriever = ReplayEvidenceRetriever(Materials(), annotations=annotations)

    result = asyncio.run(retriever.retrieve(_replay_request()))

    source = result.evidence[0].source
    assert isinstance(source, AnnotationSourceV2)
    assert source.highlightId == highlight_id
    assert source.excerpt == "B+ tree 노드 분할 조건"


def test_replay_truncates_a_long_snapshot_to_the_excerpt_budget() -> None:
    annotations = Annotations(window=(_annotation_hit(uuid4(), text="가" * 900),))
    retriever = ReplayEvidenceRetriever(Materials(), annotations=annotations)

    result = asyncio.run(retriever.retrieve(_replay_request()))

    assert len(result.evidence[0].source.excerpt) == 300
    # The model still sees the whole snapshot; only the user-facing excerpt is clipped.
    assert len(result.evidence[0].content) == 900


def test_annotation_only_evidence_is_sufficient_in_both_paths() -> None:
    """Materials and captions can be empty and the answer still has ground to stand on."""
    live = CombinedEvidenceRetriever(
        Materials(), Captions(), annotations=Annotations(window=(_annotation_hit(uuid4()),))
    )
    replay = ReplayEvidenceRetriever(
        Materials(), annotations=Annotations(window=(_annotation_hit(uuid4()),))
    )

    assert asyncio.run(live.retrieve(_live_request())).sufficient is True
    assert asyncio.run(replay.retrieve(_replay_request())).sufficient is True


@pytest.mark.parametrize("build", ["live", "replay"])
def test_without_annotations_wired_both_paths_behave_exactly_as_before(build: str) -> None:
    if build == "live":
        retriever = CombinedEvidenceRetriever(Materials((_material_hit(),)), Captions())
        result = asyncio.run(retriever.retrieve(_live_request()))
    else:
        retriever = ReplayEvidenceRetriever(Materials((_material_hit(),)))
        result = asyncio.run(retriever.retrieve(_replay_request()))

    assert [evidence.source.type for evidence in result.evidence] == ["PPTX"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"annotation_top_k": 0},
        {"annotation_top_k": 51},
        {"annotation_window_size": 0},
        {"annotation_vector_threshold": -0.1},
        {"annotation_vector_threshold": 1.1},
    ],
)
def test_rejects_unusable_annotation_limits(overrides: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        CombinedEvidenceRetriever(Materials(), Captions(), **overrides)
    with pytest.raises(ValueError):
        ReplayEvidenceRetriever(Materials(), **overrides)


def test_annotation_retrieval_is_absent_until_the_switch_is_on() -> None:
    """Off must leave both RAG paths byte-identical to before ADR-0043."""
    from app import wiring
    from app.config import Settings

    settings = Settings(instance_id="ai-api-1")

    assert settings.annotation_evidence_enabled is False
    assert wiring._build_annotation_retrieval(settings, object(), object()) is None


def test_annotation_retrieval_reuses_the_callers_engine_and_embedding() -> None:
    """Snapshots live in the same database and use the same embedding model as material
    chunks, so a second connection pool would buy nothing."""
    from app import wiring
    from app.config import Settings

    settings = Settings(instance_id="ai-api-1", annotation_evidence_enabled=True)
    embedding = object()

    service = wiring._build_annotation_retrieval(settings, object(), embedding)

    assert service is not None
    assert service._embedding is embedding
