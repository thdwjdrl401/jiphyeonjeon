import asyncio
from uuid import UUID

from app.rag import (
    CaptionContextItem,
    CaptionSourceV2,
    PptxSourceV2,
    RagAnswerRequestV2,
    ReplayContext,
    ReplayEvidenceRetriever,
)
from app.retrieval import MaterialChunkHit

LESSON_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
CURRICULUM_ID = UUID("55555555-5555-4555-8555-555555555555")
OTHER_CURRICULUM_ID = UUID("66666666-6666-4666-8666-666666666666")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")
SESSION_ID = "44444444-4444-4444-8444-444444444444"


def _request(
    *,
    captions: tuple[CaptionContextItem, ...] = (),
    question_session_ms: int = 735_000,
) -> RagAnswerRequestV2:
    return RagAnswerRequestV2(
        requestId="request-1",
        lessonId=LESSON_ID,
        curriculumId=CURRICULUM_ID,
        sessionId=SESSION_ID,
        question="여기서 말한 consumer group이 뭐야?",
        context=ReplayContext(questionSessionMs=question_session_ms, captions=captions),
        issuedAtMs=1_700_000_000_000,
    )


def _hit(
    *,
    lesson_id: UUID = LESSON_ID,
    curriculum_id: UUID = CURRICULUM_ID,
    vector_score: float = 0.8,
    lexical_score: float = 0.0,
) -> MaterialChunkHit:
    return MaterialChunkHit(
        chunk_id=1,
        material_version_id=2,
        lesson_id=lesson_id,
        curriculum_id=curriculum_id,
        material_id=MATERIAL_ID,
        material_version=1,
        page=12,
        chunk_index=0,
        text="Consumer Group은 여러 Consumer가 메시지를 분담해서 처리하도록 합니다.",
        vector_score=vector_score,
        lexical_score=lexical_score,
        score=vector_score,
    )


def _caption_item(
    *,
    segment_index: int,
    start_ms: int,
    end_ms: int,
    text: str,
    stt_session_id: str = "stt-attempt-2",
) -> CaptionContextItem:
    return CaptionContextItem(
        sttSessionId=stt_session_id,
        segmentIndex=segment_index,
        startSessionMs=start_ms,
        endSessionMs=end_ms,
        text=text,
    )


class Materials:
    def __init__(self, hits: tuple[MaterialChunkHit, ...]) -> None:
        self.hits = hits
        self.call: dict[str, object] | None = None

    async def retrieve(self, **kwargs: object) -> tuple[MaterialChunkHit, ...]:
        self.call = kwargs
        return self.hits


def test_combines_pptx_top_k_with_single_merged_caption_source() -> None:
    materials = Materials((_hit(),))
    captions = (
        _caption_item(
            segment_index=41, start_ms=706_000, end_ms=711_000, text="토픽에는 여러 파티션이 있고 "
        ),
        _caption_item(
            segment_index=42,
            start_ms=711_200,
            end_ms=716_800,
            text="컨슈머 그룹은 여러 소비자가 메시지를 분담해서 처리하도록 합니다.",
        ),
    )
    retriever = ReplayEvidenceRetriever(materials, material_top_k=3)

    result = asyncio.run(retriever.retrieve(_request(captions=captions)))

    assert result.sufficient is True
    assert materials.call == {
        "curriculum_id": CURRICULUM_ID,
        "query_text": "여기서 말한 consumer group이 뭐야?",
        "top_k": 3,
    }
    # exactly one PPTX evidence + exactly one merged CAPTION evidence (ADR-0037: at most one)
    assert len(result.evidence) == 2
    pptx_evidence, caption_evidence = result.evidence
    assert pptx_evidence.source == PptxSourceV2(
        materialId=MATERIAL_ID,
        page=12,
        excerpt="Consumer Group은 여러 Consumer가 메시지를 분담해서 처리하도록 합니다.",
    )
    assert caption_evidence.content == (
        "토픽에는 여러 파티션이 있고 컨슈머 그룹은 여러 소비자가 메시지를 분담해서 처리하도록 합니다."
    )
    assert caption_evidence.source == CaptionSourceV2(
        sessionId=SESSION_ID,
        startSessionMs=706_000,
        endSessionMs=716_800,
        excerpt=caption_evidence.content,
    )
    # the CAPTION source must never carry sttSessionId (ADR-0037 answer.done.sources example)
    assert not hasattr(caption_evidence.source, "sttSessionId")


def test_no_captions_still_answers_from_pptx_alone() -> None:
    materials = Materials((_hit(),))
    retriever = ReplayEvidenceRetriever(materials)

    result = asyncio.run(retriever.retrieve(_request(captions=())))

    assert result.sufficient is True
    assert len(result.evidence) == 1
    assert result.evidence[0].source.type == "PPTX"


def test_no_pptx_and_no_captions_is_insufficient() -> None:
    materials = Materials((_hit(vector_score=0.0, lexical_score=0.0),))
    retriever = ReplayEvidenceRetriever(materials)

    result = asyncio.run(retriever.retrieve(_request(captions=())))

    assert result.sufficient is False
    assert result.evidence == ()


def test_excerpt_is_truncated_to_max_chars_from_original_text() -> None:
    long_text = "가" * 500
    materials = Materials(())
    captions = (_caption_item(segment_index=1, start_ms=0, end_ms=1_000, text=long_text),)
    retriever = ReplayEvidenceRetriever(materials, excerpt_max_chars=300)

    result = asyncio.run(retriever.retrieve(_request(captions=captions)))

    (caption_evidence,) = result.evidence
    assert caption_evidence.source.excerpt == long_text[:300]
    assert len(caption_evidence.source.excerpt) == 300
    assert caption_evidence.content == long_text


def test_scope_is_preserved_for_final_service_revalidation() -> None:
    materials = Materials((_hit(curriculum_id=OTHER_CURRICULUM_ID),))
    captions = (_caption_item(segment_index=1, start_ms=0, end_ms=1_000, text="자막"),)
    retriever = ReplayEvidenceRetriever(materials)

    result = asyncio.run(
        retriever.retrieve(
            RagAnswerRequestV2.model_validate(
                {
                    **_request(captions=captions).model_dump(mode="json"),
                    "lessonId": str(OTHER_LESSON_ID),
                }
            )
        )
    )

    pptx_evidence, caption_evidence = result.evidence
    assert pptx_evidence.curriculum_id == OTHER_CURRICULUM_ID
    assert caption_evidence.lesson_id == OTHER_LESSON_ID
