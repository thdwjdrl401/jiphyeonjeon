import asyncio
import math
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest

from app.adapters.pgvector_material_retrieval import PgvectorActiveMaterialRepository
from app.retrieval import ActiveMaterialRetrievalService, MaterialChunkHit


@dataclass
class FakeEmbedding:
    vector: Sequence[float]
    observed_text: str | None = None

    async def embed_query(self, text: str) -> Sequence[float]:
        self.observed_text = text
        return self.vector


class FakeRepository:
    def __init__(self, hits: tuple[MaterialChunkHit, ...] = ()) -> None:
        self.hits = hits
        self.call: dict[str, object] | None = None

    async def search_active(self, **kwargs) -> tuple[MaterialChunkHit, ...]:
        self.call = kwargs
        return self.hits


class FakeMappingsResult:
    def __init__(self, rows: list[Mapping[str, object]]) -> None:
        self._rows = rows

    def mappings(self) -> "FakeMappingsResult":
        return self

    def all(self) -> list[Mapping[str, object]]:
        return self._rows


class FakeConnection:
    def __init__(self, rows: list[Mapping[str, object]]) -> None:
        self._rows = rows
        self.calls: list[tuple[str, Mapping[str, object] | None]] = []

    async def execute(self, statement, parameters=None):
        rendered = str(statement)
        self.calls.append((rendered, parameters))
        if rendered.startswith("SET LOCAL ROLE"):
            return FakeMappingsResult([])
        return FakeMappingsResult(self._rows)


class FakeTransaction(AbstractAsyncContextManager[FakeConnection]):
    def __init__(self, connection: FakeConnection) -> None:
        self._connection = connection

    async def __aenter__(self) -> FakeConnection:
        return self._connection

    async def __aexit__(self, *exc_info: object) -> None:
        return None


class FakeEngine:
    def __init__(self, rows: list[Mapping[str, object]]) -> None:
        self.connection = FakeConnection(rows)

    def begin(self) -> FakeTransaction:
        return FakeTransaction(self.connection)


def _hit(lesson_id: UUID, curriculum_id: UUID, material_id: UUID) -> MaterialChunkHit:
    return MaterialChunkHit(
        chunk_id=10,
        material_version_id=20,
        lesson_id=lesson_id,
        curriculum_id=curriculum_id,
        material_id=material_id,
        material_version=2,
        page=3,
        chunk_index=4,
        text="deterministic chunk",
        vector_score=0.9,
        lexical_score=0.2,
        score=0.76,
    )


def test_service_normalizes_query_embedding_before_scoped_search() -> None:
    curriculum_id = uuid4()
    lesson_id = uuid4()
    expected_hit = _hit(lesson_id, curriculum_id, uuid4())
    embedding = FakeEmbedding([3.0, 4.0, *([0.0] * 1022)])
    repository = FakeRepository((expected_hit,))
    service = ActiveMaterialRetrievalService(embedding, repository)

    result = asyncio.run(
        service.retrieve(
            curriculum_id=curriculum_id,
            lesson_id=lesson_id,
            query_text="  vector query  ",
            top_k=7,
        )
    )

    assert result == (expected_hit,)
    assert embedding.observed_text == "vector query"
    assert repository.call is not None
    # 강의를 저장소까지 넘긴다 — 여기서 떨어뜨리면 SQL 조건이 있어도 소용이 없다.
    assert repository.call["lesson_id"] == lesson_id
    assert repository.call["curriculum_id"] == curriculum_id
    assert repository.call["query_text"] == "vector query"
    observed_vector = repository.call["query_embedding"]
    assert isinstance(observed_vector, tuple)
    assert observed_vector[:2] == pytest.approx((0.6, 0.8))
    assert math.sqrt(sum(value * value for value in observed_vector)) == pytest.approx(1.0)


@pytest.mark.parametrize(
    ("vector", "error"),
    [
        ([1.0] * 1023, "1024"),
        ([0.0] * 1024, "non-zero"),
        ([float("nan"), *([0.0] * 1023)], "finite"),
    ],
)
def test_service_rejects_invalid_query_embedding(vector, error: str) -> None:
    service = ActiveMaterialRetrievalService(FakeEmbedding(vector), FakeRepository())

    with pytest.raises(ValueError, match=error):
        asyncio.run(
            service.retrieve(curriculum_id=uuid4(), lesson_id=uuid4(), query_text="question")
        )


def test_repository_sql_enforces_role_active_curriculum_scope_and_maps_hits() -> None:
    lesson_id = uuid4()
    curriculum_id = uuid4()
    material_id = uuid4()
    engine = FakeEngine(
        [
            {
                "chunk_id": 10,
                "material_version_id": 20,
                "lesson_id": lesson_id,
                "curriculum_id": curriculum_id,
                "material_id": str(material_id),
                "material_version": 2,
                "page": 3,
                "chunk_index": 4,
                "text": "deterministic chunk",
                "vector_score": 0.9,
                "lexical_score": 0.2,
                "score": 0.76,
            }
        ]
    )
    repository = PgvectorActiveMaterialRepository(
        engine,  # type: ignore[arg-type]
        runtime_role="ai_reader_test",
    )

    hits = asyncio.run(
        repository.search_active(
            curriculum_id=curriculum_id,
            lesson_id=lesson_id,
            query_text="active query",
            query_embedding=[1.0, *([0.0] * 1023)],
            top_k=5,
        )
    )

    assert hits == (_hit(lesson_id, curriculum_id, material_id),)
    assert engine.connection.calls[0] == ("SET LOCAL ROLE ai_reader_test", None)
    statement, parameters = engine.connection.calls[1]
    compact_sql = " ".join(statement.split())
    assert "JOIN ai.document_chunk dc ON dc.material_version_id = mv.id" in compact_sql
    assert "JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id" in compact_sql
    assert "mv.curriculum_id = CAST(:curriculum_id AS uuid)" in compact_sql
    assert "mv.state = 'ACTIVE'" in compact_sql
    # 자료가 붙은 자리를 벗어나지 않게 하는 조건. 이 줄이 빠지면 옆 강의 자료가 근거로 샌다.
    assert "(mv.lesson_id IS NULL OR mv.lesson_id = CAST(:lesson_id AS uuid))" in compact_sql
    assert "1.0 / (60.0 + vector_rank)" in compact_sql
    assert parameters is not None
    assert parameters["curriculum_id"] == str(curriculum_id)


@pytest.mark.parametrize("runtime_role", ["AI_APP", "bad-role", "x; DROP ROLE x"])
def test_repository_rejects_unsafe_runtime_role(runtime_role: str) -> None:
    with pytest.raises(ValueError, match="safe"):
        PgvectorActiveMaterialRepository(  # type: ignore[arg-type]
            FakeEngine([]),
            runtime_role=runtime_role,
        )
