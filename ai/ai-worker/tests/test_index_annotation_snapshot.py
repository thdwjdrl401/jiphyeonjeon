from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from PIL import Image

from app.application import (
    DeleteAnnotationSnapshot,
    IndexAnnotationSnapshot,
    annotation_delete_job_id,
    annotation_embed_job_id,
    map_annotation_embed_job,
)
from app.contracts import AnnotationEmbedJob
from app.domain import (
    MAX_ANNOTATION_TEXT_CHARS,
    AnnotationIngestionError,
    AnnotationRecord,
    AnnotationSnapshot,
    EmbeddingContractError,
)


CAPTURED_AT = datetime(2026, 8, 4, 13, 20, 5, tzinfo=timezone(timedelta(hours=9)))


def _snapshot(**overrides: object) -> AnnotationSnapshot:
    values: dict[str, object] = {
        "snapshot_id": uuid4(),
        "asset_id": uuid4(),
        "curriculum_id": uuid4(),
        "lesson_id": uuid4(),
        "session_id": uuid4(),
        "session_ms": 725_300,
        "captured_at": CAPTURED_AT,
        "interpreted_text": "B+ tree 노드 분할 조건",
        **overrides,
    }
    return AnnotationSnapshot(**values)  # type: ignore[arg-type]


class ImageStore:
    def __init__(self, image: bytes | None = None) -> None:
        self.image = _png(800, 600) if image is None else image
        self.reads: list[UUID] = []

    async def read_annotation_image(self, asset_id: UUID) -> bytes:
        self.reads.append(asset_id)
        return self.image


class Reader:
    def __init__(self, text: str = "모델이 읽은 텍스트", error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls = 0
        self.images: list[bytes] = []

    async def read(self, image: bytes) -> str:
        self.calls += 1
        self.images.append(image)
        if self.error is not None:
            raise self.error
        return self.text


def _png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color=(10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


class EmbeddingModel:
    model_name = "BAAI/bge-m3"
    model_revision = "5617a9f61b028005a4858fdac845db406aefb181"
    dimensions = 1024

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

    async def mark_deleted(self, snapshot_id: UUID) -> None:
        self.deleted.append(snapshot_id)


def _use_case(
    *, image_store: ImageStore | None = None, reader: Reader | None = None, **kwargs: object
) -> tuple[IndexAnnotationSnapshot, IndexStorage]:
    storage = IndexStorage()
    use_case = IndexAnnotationSnapshot(
        image_store or ImageStore(),
        kwargs.get("embedding_model") or EmbeddingModel(),  # type: ignore[arg-type]
        storage,
        reader=reader,
    )
    return use_case, storage


async def test_trusts_the_interpretation_spring_already_has() -> None:
    """Re-reading an image Spring interpreted would split the instructor's screen from the
    answer's citation (ADR-0043 §3)."""
    image_store = ImageStore()
    reader = Reader()
    use_case, storage = _use_case(image_store=image_store, reader=reader)

    record = await use_case.execute(_snapshot())

    assert record.text == "B+ tree 노드 분할 조건"
    assert record.text_origin == "SPRING"
    assert reader.calls == 0
    assert image_store.reads == []
    assert storage.upserts == [record]


@pytest.mark.parametrize("interpreted_text", [None, "", "   "])
async def test_reads_the_image_only_when_spring_sent_no_interpretation(
    interpreted_text: str | None,
) -> None:
    image_store = ImageStore()
    reader = Reader("모델이 읽은 텍스트")
    use_case, storage = _use_case(image_store=image_store, reader=reader)
    snapshot = _snapshot(interpreted_text=interpreted_text)

    record = await use_case.execute(snapshot)

    assert record.text == "모델이 읽은 텍스트"
    assert record.text_origin == "MODEL"
    assert reader.calls == 1
    assert image_store.reads == [snapshot.asset_id]


async def test_oversized_crops_reach_the_model_already_downscaled() -> None:
    """Vision billing is per tile, so the long edge is capped before the call (ADR-0043 §7)."""
    image_store = ImageStore(_png(3_136, 1_568))
    reader = Reader()
    use_case, _ = _use_case(image_store=image_store, reader=reader)

    await use_case.execute(_snapshot(interpreted_text=None))

    with Image.open(io.BytesIO(reader.images[0])) as sent:
        assert sent.size == (1_568, 784)


async def test_a_crop_within_budget_reaches_the_model_untouched() -> None:
    original = _png(800, 600)
    reader = Reader()
    use_case, _ = _use_case(image_store=ImageStore(original), reader=reader)

    await use_case.execute(_snapshot(interpreted_text=None))

    assert reader.images[0] is original


async def test_preserves_the_timeline_anchor_and_scope_on_the_stored_record() -> None:
    use_case, storage = _use_case()
    snapshot = _snapshot()

    record = await use_case.execute(snapshot)

    assert record.snapshot_id == snapshot.snapshot_id
    assert record.curriculum_id == snapshot.curriculum_id
    assert record.session_id == snapshot.session_id
    assert record.session_ms == 725_300
    assert record.captured_at == CAPTURED_AT
    assert len(record.embedding) == 1024


async def test_truncates_text_to_what_storage_accepts() -> None:
    use_case, storage = _use_case()

    record = await use_case.execute(_snapshot(interpreted_text="가" * 5_000))

    assert len(record.text) == MAX_ANNOTATION_TEXT_CHARS


async def test_embeds_the_indexed_text_not_the_raw_interpretation() -> None:
    model = EmbeddingModel()
    storage = IndexStorage()
    use_case = IndexAnnotationSnapshot(ImageStore(), model, storage, reader=Reader())

    record = await use_case.execute(_snapshot(interpreted_text="  다듬어진 텍스트  "))

    assert model.texts == [("다듬어진 텍스트",)]
    assert record.text == "다듬어진 텍스트"


async def test_reader_failure_is_terminal_rather_than_an_empty_snapshot() -> None:
    """A blank snapshot would sit in the index matching nothing — worse than a failed job."""
    reader = Reader(error=RuntimeError("gms down"))
    use_case, storage = _use_case(reader=reader)

    with pytest.raises(RuntimeError, match="gms down"):
        await use_case.execute(_snapshot(interpreted_text=None))

    assert storage.upserts == []


async def test_blank_model_text_is_rejected_before_indexing() -> None:
    use_case, storage = _use_case(reader=Reader("   "))

    with pytest.raises(AnnotationIngestionError, match="produced no text"):
        await use_case.execute(_snapshot(interpreted_text=None))

    assert storage.upserts == []


async def test_uninterpreted_snapshot_without_a_reader_fails_loudly() -> None:
    """Extraction disabled must not quietly index nothing."""
    use_case, storage = _use_case(reader=None)

    with pytest.raises(AnnotationIngestionError, match="no reader is configured"):
        await use_case.execute(_snapshot(interpreted_text=None))

    assert storage.upserts == []


async def test_rejects_an_embedding_adapter_of_the_wrong_dimension() -> None:
    storage = IndexStorage()
    use_case = IndexAnnotationSnapshot(
        ImageStore(), EmbeddingModel(dimensions=768), storage, reader=Reader()
    )

    with pytest.raises(EmbeddingContractError, match="1024 dimensions"):
        await use_case.execute(_snapshot())

    assert storage.upserts == []


async def test_rejects_an_embedding_result_that_does_not_match_the_input_count() -> None:
    storage = IndexStorage()
    use_case = IndexAnnotationSnapshot(
        ImageStore(), EmbeddingModel(count=2), storage, reader=Reader()
    )

    with pytest.raises(EmbeddingContractError, match="count does not match"):
        await use_case.execute(_snapshot())

    assert storage.upserts == []


async def test_reindexing_the_same_snapshot_id_replaces_rather_than_duplicates() -> None:
    use_case, storage = _use_case()
    snapshot_id = uuid4()

    first = await use_case.execute(_snapshot(snapshot_id=snapshot_id, interpreted_text="처음"))
    second = await use_case.execute(_snapshot(snapshot_id=snapshot_id, interpreted_text="수정"))

    assert first.snapshot_id == second.snapshot_id
    assert [record.text for record in storage.upserts] == ["처음", "수정"]


async def test_delete_is_idempotent_for_a_snapshot_that_was_never_indexed() -> None:
    storage = IndexStorage()
    use_case = DeleteAnnotationSnapshot(storage)
    snapshot_id = uuid4()

    await use_case.execute(snapshot_id)
    await use_case.execute(snapshot_id)

    assert storage.deleted == [snapshot_id, snapshot_id]


def test_snapshot_rejects_a_naive_captured_at() -> None:
    with pytest.raises(AnnotationIngestionError, match="offset"):
        _snapshot(captured_at=datetime(2026, 8, 4, 13, 20, 5))


def test_snapshot_rejects_a_negative_timeline_anchor() -> None:
    with pytest.raises(AnnotationIngestionError, match="session_ms"):
        _snapshot(session_ms=-1)


def test_maps_the_wire_job_to_a_snapshot_without_inventing_material_identity() -> None:
    job = AnnotationEmbedJob.model_validate(
        {
            "taskType": "ANNOTATION_EMBED",
            "snapshotId": "550e8400-e29b-41d4-a716-446655440010",
            "assetId": "550e8400-e29b-41d4-a716-446655440011",
            "sessionId": "550e8400-e29b-41d4-a716-446655440012",
            "lessonId": "550e8400-e29b-41d4-a716-446655440013",
            "curriculumId": "550e8400-e29b-41d4-a716-446655440014",
            "sessionMs": 725_300,
            "capturedAt": "2026-08-04T13:20:05+09:00",
            "interpretedText": "B+ tree",
            "policy": {"embedModel": "bge-m3"},
            "contractVersion": 1,
        }
    )

    snapshot = map_annotation_embed_job(job)

    assert snapshot.snapshot_id == job.snapshot_id
    assert snapshot.session_ms == 725_300
    assert snapshot.captured_at == CAPTURED_AT
    assert snapshot.interpreted_text == "B+ tree"


def test_job_ids_distinguish_indexing_from_withdrawal() -> None:
    snapshot_id = "550e8400-e29b-41d4-a716-446655440010"

    assert annotation_embed_job_id(snapshot_id) == f"ANNOTATION_EMBED:{snapshot_id}"
    assert annotation_delete_job_id(snapshot_id) == f"ANNOTATION_EMBED_DELETE:{snapshot_id}"
