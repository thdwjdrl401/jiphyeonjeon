from uuid import UUID

import pytest

from app.adapters.pgvector_index import (
    PgvectorIndexRepository,
    _assert_job_identity,
    _chunk_fingerprint,
    _normalize_vector,
    _vector_literal,
)
from app.domain import BGE_M3_DIMENSIONS, ChunkRecord, StagedMaterial


class NeverBeginEngine:
    def begin(self):
        raise AssertionError("validation must happen before opening a DB transaction")


def material() -> StagedMaterial:
    return StagedMaterial(
        job_id="job-1",
        idempotency_key="material-v1",
        tenant_id="tenant-test",
        curriculum_id=UUID("11111111-1111-4111-8111-111111111111"),
        lesson_id=UUID("22222222-2222-4222-8222-222222222222"),
        material_id=UUID("33333333-3333-4333-8333-333333333333"),
        material_version=1,
        source_bucket="lecture-materials",
        source_object_key="lessons/material.pptx",
        correlation_id="correlation-1",
        chunk_strategy="slide-v1",
        model_name="BAAI/bge-m3",
        model_revision="abcdef123456",
    )


def chunk(chunk_index: int) -> ChunkRecord:
    return ChunkRecord(
        chunk_index=chunk_index,
        page=1,
        text=f"chunk-{chunk_index}",
        content_hash=f"hash-{chunk_index}",
        embedding=[0.25] * BGE_M3_DIMENSIONS,
    )


async def test_stage_rejects_empty_chunks_before_database_access() -> None:
    repository = PgvectorIndexRepository(NeverBeginEngine())  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="at least one"):
        await repository.stage(material(), [])


async def test_stage_rejects_duplicate_chunk_indexes_before_database_access() -> None:
    repository = PgvectorIndexRepository(NeverBeginEngine())  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="unique"):
        await repository.stage(material(), [chunk(0), chunk(0)])


def test_normalizes_vector_to_unit_length() -> None:
    normalized = _normalize_vector([2.0] * BGE_M3_DIMENSIONS)

    assert sum(value**2 for value in normalized) ** 0.5 == pytest.approx(1.0)
    assert _vector_literal(normalized).startswith("[")
    assert _vector_literal(normalized).endswith("]")


@pytest.mark.parametrize(
    "values",
    [
        [0.0] * BGE_M3_DIMENSIONS,
        [float("nan")] + [0.1] * (BGE_M3_DIMENSIONS - 1),
        [float("inf")] + [0.1] * (BGE_M3_DIMENSIONS - 1),
        [1e308] * BGE_M3_DIMENSIONS,
        [0.1] * (BGE_M3_DIMENSIONS - 1),
    ],
)
def test_normalization_rejects_invalid_vectors(values: list[float]) -> None:
    with pytest.raises(ValueError):
        _normalize_vector(values)


def test_chunk_fingerprint_is_order_independent_but_content_sensitive() -> None:
    first = chunk(0)
    second = chunk(1)
    changed = ChunkRecord(
        chunk_index=1,
        page=2,
        text="changed",
        content_hash="hash-1",
        embedding=[0.25] * BGE_M3_DIMENSIONS,
    )

    assert _chunk_fingerprint([first, second]) == _chunk_fingerprint([second, first])
    assert _chunk_fingerprint([first, second]) != _chunk_fingerprint([first, changed])


def test_job_identity_requires_every_expected_field() -> None:
    _assert_job_identity({"job_id": "same", "version": 1}, {"version": 1})

    with pytest.raises(ValueError, match="reused"):
        _assert_job_identity({"job_id": "same", "version": 2}, {"version": 1})
    with pytest.raises(ValueError, match="reused"):
        _assert_job_identity(None, {"version": 1})
