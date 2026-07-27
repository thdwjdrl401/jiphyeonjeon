from dataclasses import replace
import math
from uuid import UUID

import pytest

from app.domain import BGE_M3_DIMENSIONS, ChunkRecord, StagedMaterial


CURRICULUM_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")


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
        chunk_strategy="slide-v1",
        model_name="BAAI/bge-m3",
        model_revision="abcdef123456",
    )


def chunk(embedding=None) -> ChunkRecord:
    return ChunkRecord(
        chunk_index=0,
        page=1,
        text="chunk text",
        content_hash="content-hash",
        embedding=embedding if embedding is not None else [0.1] * BGE_M3_DIMENSIONS,
    )


@pytest.mark.parametrize("dimensions", [0, 1023, 1025])
def test_chunk_requires_exact_bge_m3_dimensions(dimensions: int) -> None:
    with pytest.raises(ValueError, match="1024"):
        chunk([0.1] * dimensions)


@pytest.mark.parametrize(
    "embedding",
    [
        [0.0] * BGE_M3_DIMENSIONS,
        [math.nan] + [0.1] * (BGE_M3_DIMENSIONS - 1),
        [math.inf] + [0.1] * (BGE_M3_DIMENSIONS - 1),
        [1e308] * BGE_M3_DIMENSIONS,
    ],
)
def test_chunk_rejects_zero_or_non_finite_vector(embedding: list[float]) -> None:
    with pytest.raises(ValueError, match="finite non-zero"):
        chunk(embedding)


def test_chunk_copies_embedding_to_an_immutable_sequence() -> None:
    embedding = [0.1] * BGE_M3_DIMENSIONS

    record = chunk(embedding)
    embedding[0] = 1.0

    assert isinstance(record.embedding, tuple)
    assert record.embedding[0] == 0.1


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("chunk_index", -1, "non-negative"),
        ("page", 0, "positive"),
        ("text", " ", "empty"),
        ("content_hash", "", "empty"),
    ],
)
def test_chunk_rejects_invalid_metadata(field: str, value, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        replace(chunk(), **{field: value})


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("material_version", 0, "positive"),
        ("model_name", "other/model", "BAAI/bge-m3"),
        ("model_revision", "main", "pinned"),
        ("curriculum_id", "1", "UUID"),
        ("lesson_id", "2", "UUID"),
        ("material_id", "3", "UUID"),
        ("job_id", "", "empty"),
        ("idempotency_key", " ", "empty"),
        ("tenant_id", " ", "empty"),
        ("source_bucket", "", "empty"),
        ("source_object_key", " ", "empty"),
        ("correlation_id", "", "empty"),
        ("chunk_strategy", " ", "empty"),
    ],
)
def test_material_rejects_invalid_storage_identity(field: str, value, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        replace(material(), **{field: value})


@pytest.mark.parametrize("revision", ["abcdef0", "a" * 64])
def test_material_accepts_pinned_revision_boundaries(revision: str) -> None:
    assert replace(material(), model_revision=revision).model_revision == revision


@pytest.mark.parametrize("revision", ["abcdef", "a" * 65, "ABCDEF0"])
def test_material_rejects_unpinned_revision_boundaries(revision: str) -> None:
    with pytest.raises(ValueError, match="pinned"):
        replace(material(), model_revision=revision)
