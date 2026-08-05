import asyncio
from collections.abc import Mapping
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters.pgvector_material_retrieval import PgvectorActiveMaterialRepository
from app.retrieval import ActiveMaterialRetrievalService
from conftest import IntegrationDatabase


class FixedEmbedding:
    async def embed_query(self, text: str) -> list[float]:
        return [1.0, *([0.0] * 1023)]


def _vector(first: float, second: float = 0.0) -> str:
    return "[" + ",".join([str(first), str(second), *(["0"] * 1022)]) + "]"


async def _create_schema(engine: AsyncEngine, runtime_role: str) -> None:
    # The integration database is session-scoped and shared with the other Postgres test
    # modules, so setup is idempotent and drops only the tables this module owns.
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.execute(text("CREATE SCHEMA IF NOT EXISTS ai"))
        await connection.execute(text("DROP TABLE IF EXISTS ai.chunk_embedding"))
        await connection.execute(text("DROP TABLE IF EXISTS ai.document_chunk"))
        await connection.execute(text("DROP TABLE IF EXISTS ai.material_version"))
        await connection.execute(
            text(
                """
                CREATE TABLE ai.material_version (
                  id bigint PRIMARY KEY,
                  lesson_id uuid NULL,
                  curriculum_id uuid NOT NULL,
                  material_id uuid NOT NULL,
                  material_version integer NOT NULL,
                  state varchar(16) NOT NULL
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE ai.document_chunk (
                  id bigint PRIMARY KEY,
                  material_version_id bigint NOT NULL REFERENCES ai.material_version(id),
                  chunk_index integer NOT NULL,
                  page integer NOT NULL,
                  text text NOT NULL,
                  search_vector tsvector GENERATED ALWAYS AS (
                    to_tsvector('simple', text)
                  ) STORED
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE ai.chunk_embedding (
                  chunk_id bigint PRIMARY KEY REFERENCES ai.document_chunk(id),
                  embedding vector(1024) NOT NULL
                )
                """
            )
        )
        await connection.execute(text(f"GRANT USAGE ON SCHEMA ai TO {runtime_role}"))
        await connection.execute(text(f"GRANT SELECT ON ALL TABLES IN SCHEMA ai TO {runtime_role}"))


async def _insert_chunk(
    engine: AsyncEngine,
    *,
    row_id: int,
    lesson_id,
    curriculum_id,
    material_id,
    state: str,
    content: str,
    embedding: str,
) -> None:
    values: Mapping[str, object] = {
        "id": row_id,
        "lesson_id": None if lesson_id is None else str(lesson_id),
        "curriculum_id": str(curriculum_id),
        "material_id": str(material_id),
        "state": state,
        "content": content,
        "embedding": embedding,
    }
    async with engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO ai.material_version (
                  id, lesson_id, curriculum_id, material_id, material_version, state
                ) VALUES (
                  :id, CAST(:lesson_id AS uuid), CAST(:curriculum_id AS uuid),
                  CAST(:material_id AS uuid), 1, :state
                )
                """
            ),
            values,
        )
        await connection.execute(
            text(
                """
                INSERT INTO ai.document_chunk (
                  id, material_version_id, chunk_index, page, text
                ) VALUES (:id, :id, 0, 1, :content)
                """
            ),
            values,
        )
        await connection.execute(
            text(
                """
                INSERT INTO ai.chunk_embedding (chunk_id, embedding)
                VALUES (:id, CAST(:embedding AS vector))
                """
            ),
            values,
        )


def test_real_postgres_shares_active_chunks_across_lessons_in_the_same_curriculum(
    integration_database: IntegrationDatabase,
) -> None:
    """ADR-0007: search is scoped by curriculum_id, so a sibling lesson's active material is
    included, while a different curriculum's material (even if ACTIVE) is excluded."""

    async def scenario() -> None:
        engine = create_async_engine(integration_database.database_url)
        lesson_id = uuid4()
        sibling_lesson_id = uuid4()
        curriculum_id = uuid4()
        other_curriculum_id = uuid4()
        active_material_id = uuid4()
        sibling_material_id = uuid4()
        try:
            await _create_schema(engine, integration_database.runtime_role)
            await _insert_chunk(
                engine,
                row_id=1,
                lesson_id=lesson_id,
                curriculum_id=curriculum_id,
                material_id=active_material_id,
                state="ACTIVE",
                content="target active material",
                embedding=_vector(1.0),
            )
            await _insert_chunk(
                engine,
                row_id=2,
                lesson_id=lesson_id,
                curriculum_id=curriculum_id,
                material_id=uuid4(),
                state="RETIRED",
                content="target retired material",
                embedding=_vector(1.0),
            )
            await _insert_chunk(
                engine,
                row_id=3,
                lesson_id=sibling_lesson_id,
                curriculum_id=curriculum_id,
                material_id=sibling_material_id,
                state="ACTIVE",
                content="target sibling lesson material",
                embedding=_vector(1.0),
            )
            await _insert_chunk(
                engine,
                row_id=4,
                lesson_id=uuid4(),
                curriculum_id=other_curriculum_id,
                material_id=uuid4(),
                state="ACTIVE",
                content="target other curriculum",
                embedding=_vector(1.0),
            )

            service = ActiveMaterialRetrievalService(
                FixedEmbedding(),
                PgvectorActiveMaterialRepository(
                    engine,
                    runtime_role=integration_database.runtime_role,
                ),
            )
            hits = await service.retrieve(
                curriculum_id=curriculum_id,
                query_text="target",
                top_k=10,
            )

            assert {hit.material_id for hit in hits} == {active_material_id, sibling_material_id}
            assert all(hit.curriculum_id == curriculum_id for hit in hits)
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_curriculum_scoped_material_with_no_lesson_is_searchable(
    integration_database: IntegrationDatabase,
) -> None:
    """Curriculum materials have lesson_id NULL (docs/ai/CONTRACT.md §9). Search already scopes
    by curriculum_id alone (ADR-0007), so they must come back — and the row mapper must not
    treat the NULL as corruption."""

    async def scenario() -> None:
        engine = create_async_engine(integration_database.database_url)
        curriculum_id = uuid4()
        other_curriculum_id = uuid4()
        curriculum_material_id = uuid4()
        foreign_material_id = uuid4()
        try:
            await _create_schema(engine, integration_database.runtime_role)
            await _insert_chunk(
                engine,
                row_id=1,
                lesson_id=None,
                curriculum_id=curriculum_id,
                material_id=curriculum_material_id,
                state="ACTIVE",
                content="target curriculum-wide material",
                embedding=_vector(1.0),
            )
            # A curriculum material of another curriculum must not leak in.
            await _insert_chunk(
                engine,
                row_id=2,
                lesson_id=None,
                curriculum_id=other_curriculum_id,
                material_id=foreign_material_id,
                state="ACTIVE",
                content="foreign curriculum-wide material",
                embedding=_vector(1.0),
            )

            service = ActiveMaterialRetrievalService(
                FixedEmbedding(),
                PgvectorActiveMaterialRepository(
                    engine, runtime_role=integration_database.runtime_role
                ),
            )
            hits = await service.retrieve(
                curriculum_id=curriculum_id, query_text="target", top_k=10
            )

            assert [hit.material_id for hit in hits] == [curriculum_material_id]
            assert hits[0].lesson_id is None
        finally:
            await engine.dispose()

    asyncio.run(scenario())
