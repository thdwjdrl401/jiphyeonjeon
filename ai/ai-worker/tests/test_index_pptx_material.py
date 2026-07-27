import asyncio
from collections.abc import Sequence
from io import BytesIO
import math
from uuid import UUID

import pytest
from pptx import Presentation
from pptx.util import Inches

import app.application.index_pptx_material as index_pptx_material
from app.application import IndexPptxMaterial
from app.domain import (
    BGE_M3_DIMENSIONS,
    BGE_M3_MODEL,
    ChunkRecord,
    EmbeddingContractError,
    EmptyPptxContentError,
    ExistingIndexVersion,
    StagedMaterial,
)


MODEL_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
CURRICULUM_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")


class FakeAssetStore:
    def __init__(self, source: bytes, error: BaseException | None = None) -> None:
        self.source = source
        self.error = error
        self.reads: list[tuple[str, str]] = []

    async def read_pptx(self, bucket: str, object_key: str) -> bytes:
        self.reads.append((bucket, object_key))
        if self.error is not None:
            raise self.error
        return self.source


class FakeEmbeddingModel:
    def __init__(
        self,
        *,
        model_name: str = BGE_M3_MODEL,
        model_revision: str = MODEL_REVISION,
        dimensions: int = BGE_M3_DIMENSIONS,
        vectors: Sequence[Sequence[float]] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.model_name = model_name
        self.model_revision = model_revision
        self.dimensions = dimensions
        self.vectors = vectors
        self.error = error
        self.calls: list[tuple[str, ...]] = []

    async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        copied_texts = tuple(texts)
        self.calls.append(copied_texts)
        if self.error is not None:
            raise self.error
        if self.vectors is not None:
            return self.vectors
        return tuple([0.1] * BGE_M3_DIMENSIONS for _ in copied_texts)


class FakeIndexStorage:
    def __init__(
        self,
        *,
        version_id: int = 41,
        existing: ExistingIndexVersion | None = None,
        stage_error: BaseException | None = None,
    ) -> None:
        self.version_id = version_id
        self.existing = existing
        self.stage_error = stage_error
        self.lookups: list[StagedMaterial] = []
        self.staged: list[tuple[StagedMaterial, tuple[ChunkRecord, ...]]] = []
        self.activated: list[tuple[StagedMaterial, int]] = []

    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None:
        self.lookups.append(material)
        return self.existing

    async def stage(
        self,
        material: StagedMaterial,
        chunks: Sequence[ChunkRecord],
    ) -> int:
        self.staged.append((material, tuple(chunks)))
        if self.stage_error is not None:
            raise self.stage_error
        return self.version_id

    async def activate(self, material: StagedMaterial, version_id: int) -> None:
        self.activated.append((material, version_id))


def material() -> StagedMaterial:
    return StagedMaterial(
        job_id="job-1",
        idempotency_key="material-v1",
        tenant_id="tenant-test",
        curriculum_id=CURRICULUM_ID,
        lesson_id=LESSON_ID,
        material_id=MATERIAL_ID,
        material_version=1,
        source_bucket="lecture-materials",
        source_object_key="lessons/material.pptx",
        correlation_id="correlation-1",
        chunk_strategy="slide-max-1200-v1",
        model_name=BGE_M3_MODEL,
        model_revision=MODEL_REVISION,
    )


def presentation_bytes(*slides: tuple[str, ...]) -> bytes:
    presentation = Presentation()
    blank_layout = presentation.slide_layouts[6]
    for slide_texts in slides:
        slide = presentation.slides.add_slide(blank_layout)
        for position, text in enumerate(slide_texts):
            text_box = slide.shapes.add_textbox(
                Inches(1),
                Inches(1 + position),
                Inches(8),
                Inches(0.5),
            )
            text_box.text = text

    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


async def test_indexes_ordered_chunks_and_activates_the_same_material_identity() -> None:
    staged_material = material()
    asset_store = FakeAssetStore(
        presentation_bytes(("first block", "second block"), ("third block",))
    )
    embedding_model = FakeEmbeddingModel()
    index_storage = FakeIndexStorage(version_id=73)

    version_id = await IndexPptxMaterial(
        asset_store,
        embedding_model,
        index_storage,
    ).execute(staged_material)

    assert version_id == 73
    assert index_storage.lookups == [staged_material]
    assert asset_store.reads == [(staged_material.source_bucket, staged_material.source_object_key)]
    assert embedding_model.calls == [("first block\nsecond block", "third block")]
    staged_identity, records = index_storage.staged[0]
    assert staged_identity is staged_material
    assert [(record.chunk_index, record.page, record.text) for record in records] == [
        (0, 1, "first block\nsecond block"),
        (1, 2, "third block"),
    ]
    activated_identity, activated_version_id = index_storage.activated[0]
    assert activated_identity is staged_material
    assert activated_version_id == 73


@pytest.mark.parametrize("activation_required", [False, True])
async def test_existing_result_skips_source_and_embedding(
    activation_required: bool,
) -> None:
    staged_material = material()
    asset_store = FakeAssetStore(b"must not be read")
    embedding_model = FakeEmbeddingModel()
    index_storage = FakeIndexStorage(
        existing=ExistingIndexVersion(73, activation_required=activation_required)
    )

    version_id = await IndexPptxMaterial(
        asset_store,
        embedding_model,
        index_storage,
    ).execute(staged_material)

    assert version_id == 73
    assert asset_store.reads == []
    assert embedding_model.calls == []
    assert index_storage.staged == []
    assert index_storage.activated == ([(staged_material, 73)] if activation_required else [])


@pytest.mark.parametrize(
    ("model_name", "model_revision", "dimensions"),
    [
        ("other/model", MODEL_REVISION, BGE_M3_DIMENSIONS),
        (BGE_M3_MODEL, "abcdef1", BGE_M3_DIMENSIONS),
        (BGE_M3_MODEL, MODEL_REVISION, BGE_M3_DIMENSIONS - 1),
    ],
)
async def test_embedding_identity_mismatch_fails_before_source_io(
    model_name: str,
    model_revision: str,
    dimensions: int,
) -> None:
    asset_store = FakeAssetStore(b"not accessed")
    embedding_model = FakeEmbeddingModel(
        model_name=model_name,
        model_revision=model_revision,
        dimensions=dimensions,
    )
    index_storage = FakeIndexStorage()

    with pytest.raises(EmbeddingContractError):
        await IndexPptxMaterial(
            asset_store,
            embedding_model,
            index_storage,
        ).execute(material())

    assert asset_store.reads == []
    assert embedding_model.calls == []
    assert index_storage.staged == []
    assert index_storage.activated == []


async def test_empty_presentation_never_calls_embedding_or_storage() -> None:
    asset_store = FakeAssetStore(presentation_bytes())
    embedding_model = FakeEmbeddingModel()
    index_storage = FakeIndexStorage()

    with pytest.raises(EmptyPptxContentError, match="no supported indexable text"):
        await IndexPptxMaterial(
            asset_store,
            embedding_model,
            index_storage,
        ).execute(material())

    assert len(asset_store.reads) == 1
    assert embedding_model.calls == []
    assert index_storage.staged == []
    assert index_storage.activated == []


@pytest.mark.parametrize(
    "vectors",
    [
        (),
        ([0.1] * BGE_M3_DIMENSIONS, [0.2] * BGE_M3_DIMENSIONS),
        ([0.1] * (BGE_M3_DIMENSIONS - 1),),
        ([math.nan] + [0.1] * (BGE_M3_DIMENSIONS - 1),),
        ([math.inf] + [0.1] * (BGE_M3_DIMENSIONS - 1),),
    ],
    ids=["too-few", "too-many", "wrong-dimensions", "nan", "infinity"],
)
async def test_invalid_embedding_response_never_stages(
    vectors: Sequence[Sequence[float]],
) -> None:
    asset_store = FakeAssetStore(presentation_bytes(("index me",)))
    embedding_model = FakeEmbeddingModel(vectors=vectors)
    index_storage = FakeIndexStorage()

    with pytest.raises(EmbeddingContractError):
        await IndexPptxMaterial(
            asset_store,
            embedding_model,
            index_storage,
        ).execute(material())

    assert len(embedding_model.calls) == 1
    assert index_storage.staged == []
    assert index_storage.activated == []


async def test_stage_failure_never_activates() -> None:
    stage_error = RuntimeError("stage failed")
    index_storage = FakeIndexStorage(stage_error=stage_error)

    with pytest.raises(RuntimeError, match="stage failed"):
        await IndexPptxMaterial(
            FakeAssetStore(presentation_bytes(("index me",))),
            FakeEmbeddingModel(),
            index_storage,
        ).execute(material())

    assert len(index_storage.staged) == 1
    assert index_storage.activated == []


async def test_parse_and_chunk_are_offloaded_with_asyncio_to_thread(monkeypatch) -> None:
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(function, *args):
        calls.append((function, args))
        return function(*args)

    monkeypatch.setattr(index_pptx_material.asyncio, "to_thread", fake_to_thread)

    await IndexPptxMaterial(
        FakeAssetStore(presentation_bytes(("index me",))),
        FakeEmbeddingModel(),
        FakeIndexStorage(),
    ).execute(material())

    assert len(calls) == 1
    assert calls[0][0] is index_pptx_material._parse_and_chunk


@pytest.mark.parametrize("cancel_at", ["read", "embed", "stage"])
async def test_cancellation_propagates_without_downstream_calls(cancel_at: str) -> None:
    cancellation = asyncio.CancelledError()
    asset_store = FakeAssetStore(
        presentation_bytes(("index me",)),
        error=cancellation if cancel_at == "read" else None,
    )
    embedding_model = FakeEmbeddingModel(
        error=cancellation if cancel_at == "embed" else None,
    )
    index_storage = FakeIndexStorage(
        stage_error=cancellation if cancel_at == "stage" else None,
    )

    with pytest.raises(asyncio.CancelledError):
        await IndexPptxMaterial(
            asset_store,
            embedding_model,
            index_storage,
        ).execute(material())

    assert len(asset_store.reads) == 1
    assert len(embedding_model.calls) == (0 if cancel_at == "read" else 1)
    assert len(index_storage.staged) == (1 if cancel_at == "stage" else 0)
    assert index_storage.activated == []
