import asyncio
from uuid import UUID

from app.captions import CaptionContextItem, CaptionContextResult
from app.rag import CaptionSource, CombinedEvidenceRetriever, RagAnswerRequest
from app.retrieval import MaterialChunkHit

LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
CURRICULUM_ID = UUID("55555555-5555-4555-8555-555555555555")
OTHER_CURRICULUM_ID = UUID("66666666-6666-4666-8666-666666666666")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")
SESSION_ID = "44444444-4444-4444-8444-444444444444"


def _request() -> RagAnswerRequest:
    return RagAnswerRequest(
        requestId="request-1",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="방금 설명한 개념은 무엇인가요?",
        contextTimeMs=61_500,
        issuedAtMs=1_700_000_000_000,
    )


def _hit(
    *,
    lesson_id: UUID = LESSON_ID,
    curriculum_id: UUID = CURRICULUM_ID,
    vector_score: float = 0.8,
    lexical_score: float = 0.0,
    score: float = 0.8,
) -> MaterialChunkHit:
    return MaterialChunkHit(
        chunk_id=1,
        material_version_id=2,
        lesson_id=lesson_id,
        curriculum_id=curriculum_id,
        material_id=MATERIAL_ID,
        material_version=1,
        page=4,
        chunk_index=0,
        text="PPTX 근거",
        vector_score=vector_score,
        lexical_score=lexical_score,
        score=score,
    )


def _context(
    *,
    lesson_id: UUID = LESSON_ID,
    session_id: str = SESSION_ID,
    texts: tuple[str, ...] = ("첫 문장. ", "둘째 문장.", " 셋째 문장."),
) -> CaptionContextResult:
    items = tuple(
        CaptionContextItem(
            event_id=f"event-{index}",
            sequence=index,
            stream_elapsed_ms=index * 1_000,
            text=text,
        )
        for index, text in enumerate(texts, start=1)
    )
    return CaptionContextResult(
        session_id=session_id,
        lesson_id=lesson_id,
        stt_session_id="provider-attempt-1",
        generation_id="generation-1",
        known_session=True,
        items=items,
        text="".join(texts),
        completed=False,
        incomplete=False,
        truncated=False,
        available=bool(items),
        first_stream_elapsed_ms=items[0].stream_elapsed_ms if items else None,
        last_stream_elapsed_ms=items[-1].stream_elapsed_ms if items else None,
    )


class Materials:
    def __init__(self, hits: tuple[MaterialChunkHit, ...]) -> None:
        self.hits = hits
        self.call: dict[str, object] | None = None

    async def retrieve(self, **kwargs: object) -> tuple[MaterialChunkHit, ...]:
        self.call = kwargs
        return self.hits


class Captions:
    def __init__(self, context: CaptionContextResult) -> None:
        self.context = context
        self.call: tuple[str, int] | None = None

    def query(self, session_id: str, context_time_ms: int) -> CaptionContextResult:
        self.call = (session_id, context_time_ms)
        return self.context


def test_combines_scoped_material_and_bounded_latest_attempt_caption() -> None:
    materials = Materials((_hit(), _hit(vector_score=0.1, score=0.9)))
    captions = Captions(_context())
    retriever = CombinedEvidenceRetriever(
        materials,
        captions,
        material_top_k=8,
        material_vector_threshold=0.25,
        caption_max_items=2,
    )

    result = asyncio.run(retriever.retrieve(_request()))

    assert result.sufficient is True
    assert materials.call == {
        "curriculum_id": CURRICULUM_ID,
        "query_text": "방금 설명한 개념은 무엇인가요?",
        "top_k": 8,
    }
    assert captions.call == (SESSION_ID, 61_500)
    assert [item.content for item in result.evidence] == [
        "PPTX 근거",
        "둘째 문장. 셋째 문장.",
    ]
    assert result.evidence[0].source.excerpt == "PPTX 근거"
    assert result.evidence[1].lesson_id == LESSON_ID
    assert result.evidence[1].source == CaptionSource(
        sessionId=SESSION_ID,
        sttSessionId="provider-attempt-1",
        startMs=2_000,
        endMs=3_000,
        excerpt="둘째 문장. 셋째 문장.",
    )


def test_rrf_rank_alone_cannot_make_irrelevant_material_sufficient() -> None:
    materials = Materials((_hit(vector_score=0.0, lexical_score=0.0, score=1.0),))
    captions = Captions(_context(texts=()))

    result = asyncio.run(CombinedEvidenceRetriever(materials, captions).retrieve(_request()))

    assert result.sufficient is False
    assert result.evidence == ()


def test_adapter_scope_is_preserved_for_final_service_revalidation() -> None:
    retriever = CombinedEvidenceRetriever(
        Materials((_hit(curriculum_id=OTHER_CURRICULUM_ID),)),
        Captions(_context(lesson_id=OTHER_LESSON_ID)),
    )

    result = asyncio.run(retriever.retrieve(_request()))

    pptx_evidence, caption_evidence = result.evidence
    assert pptx_evidence.curriculum_id == OTHER_CURRICULUM_ID
    assert caption_evidence.lesson_id == OTHER_LESSON_ID
