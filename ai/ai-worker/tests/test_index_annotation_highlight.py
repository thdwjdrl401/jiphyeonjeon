from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from app.application import (
    DeleteAnnotationHighlight,
    IndexAnnotationHighlight,
    annotation_delete_job_id,
    annotation_embed_job_id,
    map_annotation_embed_job,
)
from app.contracts import AnnotationEmbedJob
from app.domain import (
    MAX_ANNOTATION_TEXT_CHARS,
    AnnotationHighlight,
    AnnotationIngestionError,
    AnnotationRecord,
    EmbeddingContractError,
)


CAPTURED_AT = datetime(2026, 8, 4, 13, 20, 5, tzinfo=timezone(timedelta(hours=9)))


def _highlight(**overrides: object) -> AnnotationHighlight:
    values: dict[str, object] = {
        "highlight_id": uuid4(),
        "curriculum_id": uuid4(),
        "lesson_id": uuid4(),
        "session_id": uuid4(),
        "session_ms": 725_300,
        "captured_at": CAPTURED_AT,
        "text": "B+ tree 노드 분할 조건",
        **overrides,
    }
    return AnnotationHighlight(**values)  # type: ignore[arg-type]


class EmbeddingModel:
    model_name = "BAAI/bge-m3"
    model_revision = "5617a9f61b028005a4858fdac845db406aefb181"

    def __init__(self, *, dimensions: int = 1024, count: int = 1) -> None:
        self.dimensions = dimensions
        self._count = count
        self.texts: list[tuple[str, ...]] = []

    async def embed(self, texts):
        self.texts.append(tuple(texts))
        return tuple([1.0] + [0.0] * 1023 for _ in range(self._count))


class IndexStorage:
    def __init__(self) -> None:
        self.upserts: list[AnnotationRecord] = []
        self.deleted: list[UUID] = []

    async def upsert(self, record: AnnotationRecord) -> None:
        self.upserts.append(record)

    async def mark_deleted(self, highlight_id: UUID) -> None:
        self.deleted.append(highlight_id)


def _use_case(model: EmbeddingModel | None = None) -> tuple[IndexAnnotationHighlight, IndexStorage]:
    storage = IndexStorage()
    return IndexAnnotationHighlight(model or EmbeddingModel(), storage), storage


async def test_indexes_the_text_spring_already_produced() -> None:
    """Spring reads the crop and the instructor confirms it; the worker adds no interpretation
    of its own (ADR-0074 결정 1)."""
    use_case, storage = _use_case()

    record = await use_case.execute(_highlight())

    assert record.text == "B+ tree 노드 분할 조건"
    assert storage.upserts == [record]


async def test_preserves_the_timeline_anchor_and_scope_on_the_stored_record() -> None:
    use_case, _ = _use_case()
    highlight = _highlight()

    record = await use_case.execute(highlight)

    assert record.highlight_id == highlight.highlight_id
    assert record.curriculum_id == highlight.curriculum_id
    assert record.session_id == highlight.session_id
    assert record.session_ms == 725_300
    assert record.captured_at == CAPTURED_AT
    assert len(record.embedding) == 1024


async def test_truncates_text_to_what_storage_accepts() -> None:
    use_case, _ = _use_case()

    record = await use_case.execute(_highlight(text="가" * 5_000))

    assert len(record.text) == MAX_ANNOTATION_TEXT_CHARS


async def test_embeds_exactly_the_text_it_stores() -> None:
    model = EmbeddingModel()
    use_case, _ = _use_case(model)

    record = await use_case.execute(_highlight(text="  다듬어진 텍스트  "))

    assert model.texts == [("다듬어진 텍스트",)]
    assert record.text == "다듬어진 텍스트"


async def test_rejects_an_embedding_adapter_of_the_wrong_dimension() -> None:
    use_case, storage = _use_case(EmbeddingModel(dimensions=768))

    with pytest.raises(EmbeddingContractError, match="1024 dimensions"):
        await use_case.execute(_highlight())

    assert storage.upserts == []


async def test_rejects_an_embedding_result_that_does_not_match_the_input_count() -> None:
    use_case, storage = _use_case(EmbeddingModel(count=2))

    with pytest.raises(EmbeddingContractError, match="count does not match"):
        await use_case.execute(_highlight())

    assert storage.upserts == []


async def test_reindexing_the_same_highlight_id_replaces_rather_than_duplicates() -> None:
    use_case, storage = _use_case()
    highlight_id = uuid4()

    first = await use_case.execute(_highlight(highlight_id=highlight_id, text="처음"))
    second = await use_case.execute(_highlight(highlight_id=highlight_id, text="수정"))

    assert first.highlight_id == second.highlight_id
    assert [record.text for record in storage.upserts] == ["처음", "수정"]


async def test_delete_is_idempotent_for_a_highlight_that_was_never_indexed() -> None:
    storage = IndexStorage()
    use_case = DeleteAnnotationHighlight(storage)
    highlight_id = uuid4()

    await use_case.execute(highlight_id)
    await use_case.execute(highlight_id)

    assert storage.deleted == [highlight_id, highlight_id]


@pytest.mark.parametrize("text", ["", "   "])
def test_highlight_rejects_blank_text(text: str) -> None:
    """A blank description would sit in the index matching nothing."""
    with pytest.raises(AnnotationIngestionError, match="must not be blank"):
        _highlight(text=text)


def test_highlight_rejects_a_naive_captured_at() -> None:
    with pytest.raises(AnnotationIngestionError, match="offset"):
        _highlight(captured_at=datetime(2026, 8, 4, 13, 20, 5))


def test_highlight_rejects_a_negative_timeline_anchor() -> None:
    with pytest.raises(AnnotationIngestionError, match="session_ms"):
        _highlight(session_ms=-1)


def test_maps_the_wire_job_without_inventing_material_identity() -> None:
    job = AnnotationEmbedJob.model_validate(
        {
            "taskType": "ANNOTATION_EMBED",
            "highlightId": "550e8400-e29b-41d4-a716-446655440010",
            "sessionId": "550e8400-e29b-41d4-a716-446655440012",
            "lessonId": "550e8400-e29b-41d4-a716-446655440013",
            "curriculumId": "550e8400-e29b-41d4-a716-446655440014",
            "sessionMs": 725_300,
            "capturedAt": "2026-08-04T13:20:05+09:00",
            "text": "B+ tree",
            "policy": {"embedModel": "bge-m3"},
            "contractVersion": 1,
        }
    )

    highlight = map_annotation_embed_job(job)

    assert highlight.highlight_id == job.highlight_id
    assert highlight.session_ms == 725_300
    assert highlight.captured_at == CAPTURED_AT
    assert highlight.text == "B+ tree"


def test_job_ids_distinguish_indexing_from_withdrawal() -> None:
    highlight_id = "550e8400-e29b-41d4-a716-446655440010"

    assert annotation_embed_job_id(highlight_id) == f"ANNOTATION_EMBED:{highlight_id}"
    assert annotation_delete_job_id(highlight_id) == f"ANNOTATION_EMBED_DELETE:{highlight_id}"
