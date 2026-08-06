"""Real-Postgres behaviour of the annotation snapshot index (ADR-0043 §4, §5).

The scope, cutoff and DELETED rules decide what a learner is allowed to be answered with, so
they are verified against pgvector rather than a fake.
"""

import asyncio
from collections.abc import Mapping
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters.pgvector_annotation_retrieval import PgvectorAnnotationRepository
from app.retrieval import AnnotationRetrievalService, SessionTimeCutoff
from conftest import IntegrationDatabase


class FixedEmbedding:
    async def embed_query(self, text: str) -> list[float]:
        return [1.0, *([0.0] * 1023)]


def _vector(first: float, second: float = 0.0) -> str:
    return "[" + ",".join([str(first), str(second), *(["0"] * 1022)]) + "]"


async def _create_schema(engine: AsyncEngine, runtime_role: str) -> None:
    # The integration database is session-scoped and shared with the other Postgres test
    # modules, so setup is idempotent and drops only the table this module owns.
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.execute(text("CREATE SCHEMA IF NOT EXISTS ai"))
        await connection.execute(text("DROP TABLE IF EXISTS ai.annotation_highlight"))
        await connection.execute(
            text(
                """
                CREATE TABLE ai.annotation_highlight (
                  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                  highlight_id uuid NOT NULL UNIQUE,
                  asset_id uuid NOT NULL,
                  curriculum_id uuid NOT NULL,
                  lesson_id uuid NOT NULL,
                  session_id uuid NOT NULL,
                  session_ms bigint NOT NULL,
                  captured_at timestamptz NOT NULL DEFAULT now(),
                  text varchar(2000) NOT NULL,
                  text_origin varchar(16) NOT NULL,
                  search_vector tsvector GENERATED ALWAYS AS (
                    to_tsvector('simple', text)
                  ) STORED,
                  embedding vector(1024) NOT NULL,
                  state varchar(16) NOT NULL
                )
                """
            )
        )
        await connection.execute(text(f"GRANT USAGE ON SCHEMA ai TO {runtime_role}"))
        await connection.execute(text(f"GRANT SELECT ON ALL TABLES IN SCHEMA ai TO {runtime_role}"))


async def _insert_snapshot(
    engine: AsyncEngine,
    *,
    highlight_id,
    curriculum_id,
    lesson_id,
    session_id,
    session_ms: int,
    content: str,
    embedding: str,
    state: str = "ACTIVE",
) -> None:
    values: Mapping[str, object] = {
        "highlight_id": str(highlight_id),
        "asset_id": str(uuid4()),
        "curriculum_id": str(curriculum_id),
        "lesson_id": str(lesson_id),
        "session_id": str(session_id),
        "session_ms": session_ms,
        "content": content,
        "embedding": embedding,
        "state": state,
    }
    async with engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO ai.annotation_highlight (
                  highlight_id, asset_id, curriculum_id, lesson_id, session_id,
                  session_ms, text, text_origin, embedding, state
                ) VALUES (
                  CAST(:highlight_id AS uuid), CAST(:asset_id AS uuid),
                  CAST(:curriculum_id AS uuid), CAST(:lesson_id AS uuid),
                  CAST(:session_id AS uuid), :session_ms, :content, 'SPRING',
                  CAST(:embedding AS vector), :state
                )
                """
            ),
            values,
        )


def test_search_is_session_scoped_and_hides_deleted_snapshots(
    integration_database: IntegrationDatabase,
) -> None:
    """Search must return only the asker's session (ADR-0086): another session of the same
    curriculum and another curriculum both stay invisible, as do DELETED snapshots."""

    async def scenario() -> None:
        engine = create_async_engine(integration_database.database_url)
        curriculum_id = uuid4()
        other_curriculum_id = uuid4()
        lesson_id = uuid4()
        session_id = uuid4()
        other_session_id = uuid4()
        wanted = uuid4()
        deleted = uuid4()
        foreign = uuid4()
        sibling_session = uuid4()
        try:
            await _create_schema(engine, integration_database.runtime_role)
            await _insert_snapshot(
                engine,
                highlight_id=wanted,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=1_000,
                content="target highlight",
                embedding=_vector(1.0),
            )
            # Un-indexed by the instructor: must never come back as evidence.
            await _insert_snapshot(
                engine,
                highlight_id=deleted,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=2_000,
                content="removed highlight",
                embedding=_vector(1.0),
                state="DELETED",
            )
            # Another curriculum's highlight must not leak across the scope boundary.
            await _insert_snapshot(
                engine,
                highlight_id=foreign,
                curriculum_id=other_curriculum_id,
                lesson_id=uuid4(),
                session_id=uuid4(),
                session_ms=1_000,
                content="foreign highlight",
                embedding=_vector(1.0),
            )
            # Same curriculum, different session: the leak that motivated ADR-0086.
            await _insert_snapshot(
                engine,
                highlight_id=sibling_session,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=other_session_id,
                session_ms=1_000,
                content="sibling session highlight",
                embedding=_vector(1.0),
            )

            service = AnnotationRetrievalService(
                FixedEmbedding(),
                PgvectorAnnotationRepository(
                    engine, runtime_role=integration_database.runtime_role
                ),
            )
            hits = await service.retrieve(
                curriculum_id=curriculum_id,
                session_id=session_id,
                query_text="highlight",
                top_k=10,
            )

            assert [hit.highlight_id for hit in hits] == [wanted]
            assert hits[0].session_ms == 1_000
            assert hits[0].score is not None
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_replay_cutoff_hides_the_question_future(
    integration_database: IntegrationDatabase,
) -> None:
    """A snapshot made after the question cannot be evidence for it. Other sessions never
    appear at all — search is session-scoped (ADR-0086)."""

    async def scenario() -> None:
        engine = create_async_engine(integration_database.database_url)
        curriculum_id = uuid4()
        lesson_id = uuid4()
        session_id = uuid4()
        earlier_session_id = uuid4()
        past = uuid4()
        future = uuid4()
        other_session = uuid4()
        try:
            await _create_schema(engine, integration_database.runtime_role)
            await _insert_snapshot(
                engine,
                highlight_id=past,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=700_000,
                content="highlight before the question",
                embedding=_vector(1.0),
            )
            await _insert_snapshot(
                engine,
                highlight_id=future,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=800_000,
                content="highlight after the question",
                embedding=_vector(1.0),
            )
            await _insert_snapshot(
                engine,
                highlight_id=other_session,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=earlier_session_id,
                session_ms=900_000,
                content="highlight from a previous session",
                embedding=_vector(1.0),
            )

            service = AnnotationRetrievalService(
                FixedEmbedding(),
                PgvectorAnnotationRepository(
                    engine, runtime_role=integration_database.runtime_role
                ),
            )
            cutoff = SessionTimeCutoff(session_id=session_id, max_session_ms=735_000)

            limited = await service.retrieve(
                curriculum_id=curriculum_id,
                session_id=session_id,
                query_text="highlight",
                top_k=10,
                cutoff=cutoff,
            )
            unlimited = await service.retrieve(
                curriculum_id=curriculum_id,
                session_id=session_id,
                query_text="highlight",
                top_k=10,
            )

            assert set(hit.highlight_id for hit in limited) == {past}
            assert set(hit.highlight_id for hit in unlimited) == {past, future}
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_recent_window_returns_newest_first_regardless_of_similarity(
    integration_database: IntegrationDatabase,
) -> None:
    """ "아까 강조하신 게" is a time question: the window must order by session_ms, and must
    still return snapshots whose embedding is orthogonal to the query (ADR-0043 §5-1)."""

    async def scenario() -> None:
        engine = create_async_engine(integration_database.database_url)
        curriculum_id = uuid4()
        lesson_id = uuid4()
        session_id = uuid4()
        oldest, middle, newest = uuid4(), uuid4(), uuid4()
        try:
            await _create_schema(engine, integration_database.runtime_role)
            for highlight_id, session_ms in ((oldest, 100), (middle, 200), (newest, 300)):
                await _insert_snapshot(
                    engine,
                    highlight_id=highlight_id,
                    curriculum_id=curriculum_id,
                    lesson_id=lesson_id,
                    session_id=session_id,
                    session_ms=session_ms,
                    content="완전히 다른 내용",
                    # Orthogonal to FixedEmbedding's query vector: similarity cannot find it.
                    embedding=_vector(0.0, 1.0),
                )

            service = AnnotationRetrievalService(
                FixedEmbedding(),
                PgvectorAnnotationRepository(
                    engine, runtime_role=integration_database.runtime_role
                ),
            )
            window = await service.recent(session_id=session_id, limit=2)

            assert [hit.highlight_id for hit in window] == [newest, middle]
            assert window[0].score is None
            assert window[0].text == "완전히 다른 내용"
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_recent_window_respects_the_replay_cutoff_and_session_boundary(
    integration_database: IntegrationDatabase,
) -> None:
    async def scenario() -> None:
        engine = create_async_engine(integration_database.database_url)
        curriculum_id = uuid4()
        lesson_id = uuid4()
        session_id = uuid4()
        other_session_id = uuid4()
        past, future, foreign, removed = uuid4(), uuid4(), uuid4(), uuid4()
        try:
            await _create_schema(engine, integration_database.runtime_role)
            await _insert_snapshot(
                engine,
                highlight_id=past,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=700_000,
                content="before",
                embedding=_vector(1.0),
            )
            await _insert_snapshot(
                engine,
                highlight_id=future,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=800_000,
                content="after",
                embedding=_vector(1.0),
            )
            await _insert_snapshot(
                engine,
                highlight_id=removed,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=session_id,
                session_ms=600_000,
                content="removed",
                embedding=_vector(1.0),
                state="DELETED",
            )
            await _insert_snapshot(
                engine,
                highlight_id=foreign,
                curriculum_id=curriculum_id,
                lesson_id=lesson_id,
                session_id=other_session_id,
                session_ms=700_000,
                content="other session",
                embedding=_vector(1.0),
            )

            service = AnnotationRetrievalService(
                FixedEmbedding(),
                PgvectorAnnotationRepository(
                    engine, runtime_role=integration_database.runtime_role
                ),
            )
            window = await service.recent(
                session_id=session_id,
                limit=10,
                cutoff=SessionTimeCutoff(session_id=session_id, max_session_ms=735_000),
            )

            assert [hit.highlight_id for hit in window] == [past]
        finally:
            await engine.dispose()

    asyncio.run(scenario())
