import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import datetime, timezone
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.adapters.pgvector_annotation_index import PgvectorAnnotationIndexRepository
from app.adapters.pgvector_index import PgvectorIndexRepository
from app.adapters.pgvector_key_term_storage import PgvectorKeyTermRepository
from app.config import load_settings
from app.database_urls import parse_async_database_url, parse_migration_database_url
from app.domain import (
    BGE_M3_DIMENSIONS,
    AnnotationIngestionError,
    AnnotationRecord,
    ChunkRecord,
    StagedMaterial,
    StaleMaterialVersionError,
)
from app.ingestion import KeyTerm
from conftest import IntegrationDatabase


CURRICULUM_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_CURRICULUM_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
OTHER_LESSON_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
MATERIAL_ID = UUID("33333333-3333-4333-8333-333333333333")


def _material(version: int, *, tenant_id: str = "tenant-test") -> StagedMaterial:
    return StagedMaterial(
        job_id=f"{tenant_id}-job-{version}",
        idempotency_key=f"{tenant_id}-material-v{version}",
        tenant_id=tenant_id,
        curriculum_id=CURRICULUM_ID,
        lesson_id=LESSON_ID,
        material_id=MATERIAL_ID,
        material_version=version,
        source_bucket="lecture-materials",
        source_object_key="lessons/materials/material.pptx",
        correlation_id=f"{tenant_id}-correlation-{version}",
        chunk_strategy="slide-v1",
        model_name="BAAI/bge-m3",
        model_revision="abcdef123456",
    )


def _chunk(value: float, *, chunk_index: int = 0, content_hash: str | None = None) -> ChunkRecord:
    return ChunkRecord(
        chunk_index=chunk_index,
        page=chunk_index + 1,
        text=f"BGE-M3 integration chunk {chunk_index}",
        content_hash=content_hash or f"hash-{value}-{chunk_index}",
        embedding=[value] * BGE_M3_DIMENSIONS,
    )


@pytest.fixture(scope="module", autouse=True)
def migrate_database(integration_database: IntegrationDatabase) -> None:
    database_url = integration_database.database_url
    migration_database_url = integration_database.migration_database_url
    database_name = parse_async_database_url(database_url).database
    if not database_name or not database_name.endswith("_test"):
        pytest.fail("integration DB name must end in _test")
    if (
        not integration_database.automatically_created
        and os.getenv("AI_WORKER_ALLOW_DESTRUCTIVE_TEST_DB") != "1"
    ):
        pytest.fail("set AI_WORKER_ALLOW_DESTRUCTIVE_TEST_DB=1 for a disposable empty database")
    migration_database_name = parse_migration_database_url(migration_database_url).database
    if migration_database_name != database_name:
        pytest.fail("runtime and migration test URLs must target the same _test database")

    setting_keys = (
        "AI_WORKER_DATABASE_URL",
        "AI_WORKER_MIGRATION_DATABASE_URL",
        "AI_WORKER_DATABASE_ROLE",
        "AI_WORKER_INSTANCE_ID",
    )
    original_environment = {key: os.environ.get(key) for key in setting_keys}
    sync_engine = create_engine(migration_database_url)
    config = Config("alembic.ini")
    migration_started = False
    cleanup_authorized = False
    core_created = False
    role_created = False
    try:
        with sync_engine.begin() as connection:
            occupied = connection.scalar(
                text(
                    """
                    SELECT count(*)
                    FROM pg_namespace
                    WHERE nspname IN ('core', 'ai')
                    """
                )
            )
            alembic_exists = connection.scalar(text("SELECT to_regclass('alembic_version')"))
            current_revision = None
            if alembic_exists is not None:
                current_revision = connection.scalar(
                    text("SELECT version_num FROM alembic_version")
                )
            if occupied != 0 or current_revision is not None:
                pytest.fail(
                    "integration database must not contain core/ai schema or an active revision"
                )
            role_exists = connection.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :runtime_role)"),
                {"runtime_role": integration_database.runtime_role},
            )
            if not role_exists:
                connection.execute(
                    text(f"CREATE ROLE {integration_database.runtime_role} NOLOGIN NOINHERIT")
                )
                role_created = True
            connection.execute(text("CREATE SCHEMA core"))
            core_created = True
            connection.execute(text("CREATE TABLE core.boundary_fixture (id bigint PRIMARY KEY)"))
            connection.execute(text("INSERT INTO core.boundary_fixture VALUES (1)"))
        cleanup_authorized = True

        os.environ["AI_WORKER_DATABASE_URL"] = database_url
        os.environ["AI_WORKER_MIGRATION_DATABASE_URL"] = migration_database_url
        os.environ["AI_WORKER_DATABASE_ROLE"] = integration_database.runtime_role
        os.environ["AI_WORKER_INSTANCE_ID"] = "integration-test"
        load_settings.cache_clear()

        command.upgrade(config, "head")
        migration_started = True
        command.upgrade(config, "head")
        with sync_engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                "0003_annotation_highlight"
            )

        command.downgrade(config, "base")
        with sync_engine.connect() as connection:
            assert connection.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai')")
            )
            assert connection.scalar(text("SELECT to_regclass('ai.job_run')")) is None

        with sync_engine.begin() as connection:
            connection.execute(text("GRANT CREATE ON SCHEMA ai TO PUBLIC"))
        try:
            with pytest.raises(DBAPIError, match="direct or inherited CREATE"):
                command.upgrade(config, "head")
        finally:
            with sync_engine.begin() as connection:
                connection.execute(text("REVOKE CREATE ON SCHEMA ai FROM PUBLIC"))
        with sync_engine.connect() as connection:
            assert connection.scalar(text("SELECT to_regclass('ai.job_run')")) is None

        command.upgrade(config, "head")
        yield
    finally:
        try:
            if migration_started:
                command.downgrade(config, "base")
        finally:
            try:
                if cleanup_authorized:
                    with sync_engine.begin() as connection:
                        connection.execute(text("DROP SCHEMA IF EXISTS ai CASCADE"))
                        if core_created:
                            connection.execute(text("DROP SCHEMA IF EXISTS core CASCADE"))
                        if role_created:
                            connection.execute(
                                text(f"DROP ROLE IF EXISTS {integration_database.runtime_role}")
                            )
            finally:
                sync_engine.dispose()
                for key, value in original_environment.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value
                load_settings.cache_clear()


@pytest.fixture
async def database_engine(
    integration_database: IntegrationDatabase,
) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(integration_database.database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    TRUNCATE ai.chunk_embedding, ai.document_chunk, ai.material_version,
                             ai.model_run, ai.job_run, ai.annotation_highlight
                    RESTART IDENTITY CASCADE
                    """
                )
            )
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
def repository(
    database_engine: AsyncEngine,
    integration_database: IntegrationDatabase,
) -> PgvectorIndexRepository:
    return PgvectorIndexRepository(
        database_engine,
        runtime_role=integration_database.runtime_role,
    )


@pytest.fixture
def key_term_repository(
    database_engine: AsyncEngine,
    integration_database: IntegrationDatabase,
) -> PgvectorKeyTermRepository:
    return PgvectorKeyTermRepository(
        database_engine,
        runtime_role=integration_database.runtime_role,
    )


@pytest.fixture
def annotation_repository(
    database_engine: AsyncEngine,
    integration_database: IntegrationDatabase,
) -> PgvectorAnnotationIndexRepository:
    return PgvectorAnnotationIndexRepository(
        database_engine,
        runtime_role=integration_database.runtime_role,
    )


async def test_migration_schema_has_uuid_vector_and_cosine_hnsw(
    database_engine: AsyncEngine,
    integration_database: IntegrationDatabase,
) -> None:
    async with database_engine.connect() as connection:
        column_types = dict(
            (
                await connection.execute(
                    text(
                        """
                        SELECT column_name, data_type
                        FROM information_schema.columns
                        WHERE table_schema = 'ai'
                          AND table_name = 'material_version'
                          AND column_name IN ('curriculum_id', 'lesson_id', 'material_id')
                        """
                    )
                )
            ).all()
        )
        vector_type = await connection.scalar(
            text(
                """
                SELECT format_type(a.atttypid, a.atttypmod)
                FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ai'
                  AND c.relname = 'chunk_embedding'
                  AND a.attname = 'embedding'
                """
            )
        )
        opclass = await connection.scalar(
            text(
                """
                SELECT opc.opcname
                FROM pg_class idx
                JOIN pg_namespace n ON n.oid = idx.relnamespace
                JOIN pg_index i ON i.indexrelid = idx.oid
                JOIN pg_opclass opc ON opc.oid = i.indclass[0]
                WHERE n.nspname = 'ai' AND idx.relname = 'ix_chunk_embedding_hnsw'
                """
            )
        )
        runtime_role = (
            await connection.execute(
                text(
                    """
                    SELECT rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
                           rolreplication, rolbypassrls
                    FROM pg_roles
                    WHERE rolname = :runtime_role
                    """
                ),
                {"runtime_role": integration_database.runtime_role},
            )
        ).one()

    assert column_types == {
        "curriculum_id": "uuid",
        "lesson_id": "uuid",
        "material_id": "uuid",
    }
    assert vector_type == "vector(1024)"
    assert opclass == "vector_cosine_ops"
    assert runtime_role == (False, False, False, False, False, False, False)


async def test_shadow_version_activation_and_material_delete(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material_one = _material(1)
    material_two = _material(2)
    version_one = await repository.stage(material_one, [_chunk(0.1)])
    await repository.activate(material_one, version_one)
    await repository.activate(material_one, version_one)
    version_two = await repository.stage(material_two, [_chunk(0.2)])

    async with database_engine.connect() as connection:
        states = (
            await connection.execute(
                text(
                    """
                    SELECT material_version, state
                    FROM ai.material_version
                    WHERE tenant_id = 'tenant-test'
                    ORDER BY material_version
                    """
                )
            )
        ).all()
    assert states == [(1, "ACTIVE"), (2, "BUILDING")]

    await repository.activate(material_two, version_two)
    deleted = replace(
        _material(3),
        job_id="job-delete-3",
        idempotency_key="material-v3-delete",
    )
    assert await repository.delete_job(deleted) == 2
    assert await repository.delete_job(deleted) == 0

    async with database_engine.connect() as connection:
        remaining = await connection.scalar(text("SELECT count(*) FROM ai.material_version"))
        delete_status = await connection.scalar(
            text("SELECT status FROM ai.job_run WHERE job_id = 'job-delete-3'")
        )
    assert remaining == 0
    assert delete_status == "SUCCEEDED"


async def test_existing_index_lookup_resumes_building_and_short_circuits_completed(
    repository: PgvectorIndexRepository,
) -> None:
    material = _material(1)

    assert await repository.find_existing(material) is None
    version_id = await repository.stage(material, [_chunk(0.1)])

    building = await repository.find_existing(material)
    assert building is not None
    assert building.version_id == version_id
    assert building.activation_required is True

    await repository.activate(material, version_id)
    completed = await repository.find_existing(material)
    assert completed is not None
    assert completed.version_id == version_id
    assert completed.activation_required is False


async def test_existing_index_lookup_rejects_reused_job_identity(
    repository: PgvectorIndexRepository,
) -> None:
    material = _material(1)
    version_id = await repository.stage(material, [_chunk(0.1)])
    await repository.activate(material, version_id)

    with pytest.raises(ValueError, match="reused"):
        await repository.find_existing(replace(material, lesson_id=OTHER_LESSON_ID))


async def test_ai_runtime_role_cannot_write_core_or_create_ai_table(
    database_engine: AsyncEngine,
    integration_database: IntegrationDatabase,
) -> None:
    async with database_engine.connect() as connection:
        transaction = await connection.begin()
        await connection.execute(text(f"SET LOCAL ROLE {integration_database.runtime_role}"))
        await connection.execute(
            text(
                """
                INSERT INTO ai.job_run (
                  job_id, idempotency_key, task_type, tenant_id, curriculum_id, lesson_id,
                  material_id, material_version, status, correlation_id
                ) VALUES (
                  'permission-job', 'permission-key', 'MATERIAL_DELETE', 'permission-test',
                  '11111111-1111-4111-8111-111111111111',
                  '22222222-2222-4222-8222-222222222222',
                  '33333333-3333-4333-8333-333333333333',
                  1, 'RUNNING', 'permission-correlation'
                )
                """
            )
        )
        with pytest.raises(DBAPIError):
            await connection.execute(text("UPDATE core.boundary_fixture SET id = 2 WHERE id = 1"))
        await transaction.rollback()

    async with database_engine.connect() as connection:
        transaction = await connection.begin()
        await connection.execute(text(f"SET LOCAL ROLE {integration_database.runtime_role}"))
        with pytest.raises(DBAPIError):
            await connection.execute(text("CREATE TABLE ai.runtime_ddl_violation (id bigint)"))
        await transaction.rollback()


async def test_stage_rolls_back_all_rows_when_late_chunk_insert_fails(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(4)
    invalid_late_chunk = _chunk(0.4, chunk_index=1, content_hash="x" * 129)

    with pytest.raises(DBAPIError):
        await repository.stage(material, [_chunk(0.4), invalid_late_chunk])

    async with database_engine.connect() as connection:
        counts = {
            table: await connection.scalar(text(f"SELECT count(*) FROM ai.{table}"))
            for table in ("job_run", "model_run", "material_version", "document_chunk")
        }
    assert counts == {
        "job_run": 0,
        "model_run": 0,
        "material_version": 0,
        "document_chunk": 0,
    }


async def test_stage_is_idempotent_and_normalizes_vector(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(5)
    first = await repository.stage(material, [_chunk(0.2)])
    second = await repository.stage(material, [_chunk(0.2)])

    with pytest.raises(ValueError, match="reused"):
        await repository.stage(
            replace(material, source_object_key="lessons/materials/changed.pptx"),
            [_chunk(0.2)],
        )
    with pytest.raises(ValueError, match="reused"):
        await repository.stage(material, [_chunk(0.3)])

    async with database_engine.connect() as connection:
        stored_vector = await connection.scalar(
            text(
                """
                SELECT ce.embedding::text
                FROM ai.chunk_embedding ce
                JOIN ai.document_chunk dc ON dc.id = ce.chunk_id
                WHERE dc.material_version_id = :version_id
                """
            ),
            {"version_id": first},
        )
        job_count = await connection.scalar(
            text("SELECT count(*) FROM ai.job_run WHERE job_id = :job_id"),
            {"job_id": material.job_id},
        )

    values = [float(value) for value in stored_vector.strip("[]").split(",")]
    assert first == second
    assert sum(value**2 for value in values) ** 0.5 == pytest.approx(1.0, abs=1e-6)
    assert job_count == 1


async def test_concurrent_identical_stage_writes_one_version(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(6)
    chunks = [_chunk(0.6)]

    first, second = await asyncio.gather(
        repository.stage(material, chunks),
        repository.stage(material, chunks),
    )

    async with database_engine.connect() as connection:
        version_count = await connection.scalar(text("SELECT count(*) FROM ai.material_version"))
        chunk_count = await connection.scalar(text("SELECT count(*) FROM ai.document_chunk"))
    assert first == second
    assert version_count == 1
    assert chunk_count == 1


async def test_concurrent_activation_keeps_only_highest_version_active(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    lower_material = _material(6)
    higher_material = _material(7)
    lower = await repository.stage(lower_material, [_chunk(0.6)])
    higher = await repository.stage(higher_material, [_chunk(0.7)])

    results = await asyncio.gather(
        repository.activate(lower_material, lower),
        repository.activate(higher_material, higher),
        return_exceptions=True,
    )
    assert all(
        result is None or isinstance(result, StaleMaterialVersionError) for result in results
    )
    assert sum(isinstance(result, StaleMaterialVersionError) for result in results) <= 1

    async with database_engine.connect() as connection:
        active_versions = (
            (
                await connection.execute(
                    text(
                        """
                    SELECT material_version
                    FROM ai.material_version
                    WHERE tenant_id = 'tenant-test' AND state = 'ACTIVE'
                    """
                    )
                )
            )
            .scalars()
            .all()
        )
    assert active_versions == [7]


async def test_stored_building_version_blocks_lower_stage_and_activation(
    repository: PgvectorIndexRepository,
) -> None:
    high_first = _material(3, tenant_id="stage-order")
    await repository.stage(high_first, [_chunk(0.3)])
    with pytest.raises(StaleMaterialVersionError, match="newest stored"):
        await repository.stage(_material(2, tenant_id="stage-order"), [_chunk(0.2)])

    low = _material(2, tenant_id="activate-order")
    high = _material(3, tenant_id="activate-order")
    low_id = await repository.stage(low, [_chunk(0.2)])
    await repository.stage(high, [_chunk(0.3)])
    with pytest.raises(StaleMaterialVersionError, match="newer material"):
        await repository.activate(low, low_id)


async def test_activate_requires_the_staged_scope_and_job_identity(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(8)
    version_id = await repository.stage(material, [_chunk(0.8)])

    with pytest.raises(ValueError, match="reused"):
        await repository.activate(replace(material, curriculum_id=OTHER_CURRICULUM_ID), version_id)

    async with database_engine.connect() as connection:
        state = await connection.scalar(
            text("SELECT state FROM ai.material_version WHERE id = :version_id"),
            {"version_id": version_id},
        )
    assert state == "BUILDING"


async def test_stale_activation_and_delete_cannot_reverse_newer_version(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    stale_material = _material(8)
    current_material = _material(9)
    stale = await repository.stage(stale_material, [_chunk(0.8)])
    current = await repository.stage(current_material, [_chunk(0.9)])
    await repository.activate(current_material, current)

    with pytest.raises(StaleMaterialVersionError, match="newer material"):
        await repository.activate(stale_material, stale)
    stale_delete = replace(
        _material(8),
        job_id="job-delete-8",
        idempotency_key="material-v8-delete",
    )
    with pytest.raises(StaleMaterialVersionError, match="older"):
        await repository.delete_job(stale_delete)

    async with database_engine.connect() as connection:
        active = await connection.scalar(
            text("SELECT material_version FROM ai.material_version WHERE state = 'ACTIVE'")
        )
        stale_delete_count = await connection.scalar(
            text("SELECT count(*) FROM ai.job_run WHERE job_id = 'job-delete-8'")
        )
    assert active == 9
    assert stale_delete_count == 0


async def test_delete_tombstone_blocks_equal_or_older_index_and_allows_newer(
    repository: PgvectorIndexRepository,
) -> None:
    deleted = replace(
        _material(2),
        job_id="job-delete-2",
        idempotency_key="material-v2-delete",
    )
    assert await repository.delete_job(deleted) == 0

    with pytest.raises(StaleMaterialVersionError, match="not newer"):
        await repository.stage(_material(1), [_chunk(0.1)])
    with pytest.raises(StaleMaterialVersionError, match="not newer"):
        await repository.stage(_material(2), [_chunk(0.2)])

    newer_material = _material(3)
    newer = await repository.stage(newer_material, [_chunk(0.3)])
    await repository.activate(newer_material, newer)


async def test_job_identity_reuse_is_rejected_for_delete(
    repository: PgvectorIndexRepository,
) -> None:
    deleted = replace(
        _material(10),
        job_id="job-delete-10",
        idempotency_key="material-v10-delete",
    )
    await repository.delete_job(deleted)

    with pytest.raises(ValueError, match="reused"):
        await repository.delete_job(replace(deleted, correlation_id="different-correlation"))


async def test_delete_of_building_version_cancels_its_index_job(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(11)
    await repository.stage(material, [_chunk(0.11)])
    deleted = replace(
        material,
        job_id="job-delete-building-11",
        idempotency_key="material-v11-delete-building",
    )

    assert await repository.delete_job(deleted) == 1

    async with database_engine.connect() as connection:
        statuses = dict(
            (
                await connection.execute(
                    text(
                        """
                        SELECT task_type, status
                        FROM ai.job_run
                        ORDER BY task_type
                        """
                    )
                )
            ).all()
        )
    assert statuses == {"MATERIAL_DELETE": "SUCCEEDED", "MATERIAL_INDEX": "CANCELLED"}


async def test_failed_delete_requires_a_new_job_identity(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    deleted = replace(
        _material(12),
        job_id="failed-delete-12",
        idempotency_key="failed-delete-12",
    )
    async with database_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO ai.job_run (
                  job_id, idempotency_key, task_type, tenant_id, curriculum_id, lesson_id,
                  material_id, material_version, status, correlation_id,
                  error_code, error_message, error_retryable, ended_at
                ) VALUES (
                  :job_id, :idempotency_key, 'MATERIAL_DELETE', :tenant_id,
                  :curriculum_id, :lesson_id, :material_id, :material_version,
                  'FAILED', :correlation_id, 'DELETE_FAILED', 'fixture failure', false, now()
                )
                """
            ),
            {
                "job_id": deleted.job_id,
                "idempotency_key": deleted.idempotency_key,
                "tenant_id": deleted.tenant_id,
                "curriculum_id": deleted.curriculum_id,
                "lesson_id": deleted.lesson_id,
                "material_id": deleted.material_id,
                "material_version": deleted.material_version,
                "correlation_id": deleted.correlation_id,
            },
        )

    with pytest.raises(ValueError, match="new job identity"):
        await repository.delete_job(deleted)

    async with database_engine.connect() as connection:
        status = await connection.scalar(
            text("SELECT status FROM ai.job_run WHERE job_id = :job_id"),
            {"job_id": deleted.job_id},
        )
    assert status == "FAILED"


async def test_material_cannot_move_scope_during_reindex_or_delete(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    current_material = _material(11)
    current = await repository.stage(current_material, [_chunk(0.11)])
    await repository.activate(current_material, current)

    wrong_curriculum = replace(
        _material(12),
        curriculum_id=OTHER_CURRICULUM_ID,
        job_id="wrong-curriculum-index",
        idempotency_key="wrong-curriculum-index",
    )
    with pytest.raises(ValueError, match="cannot move"):
        await repository.stage(wrong_curriculum, [_chunk(0.12)])

    wrong_lesson_delete = replace(
        _material(12),
        lesson_id=OTHER_LESSON_ID,
        job_id="wrong-lesson-delete",
        idempotency_key="wrong-lesson-delete",
    )
    with pytest.raises(ValueError, match="cannot move"):
        await repository.delete_job(wrong_lesson_delete)

    async with database_engine.connect() as connection:
        active = await connection.scalar(
            text("SELECT material_version FROM ai.material_version WHERE state = 'ACTIVE'")
        )
        wrong_jobs = await connection.scalar(
            text(
                """
                SELECT count(*) FROM ai.job_run
                WHERE job_id IN ('wrong-curriculum-index', 'wrong-lesson-delete')
                """
            )
        )
    assert active == 11
    assert wrong_jobs == 0


async def test_same_material_uuid_is_isolated_by_tenant(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    tenant_a_material = _material(1, tenant_id="tenant-a")
    tenant_b_material = _material(1, tenant_id="tenant-b")
    tenant_a = await repository.stage(tenant_a_material, [_chunk(0.1)])
    tenant_b = await repository.stage(tenant_b_material, [_chunk(0.2)])
    await repository.activate(tenant_a_material, tenant_a)
    await repository.activate(tenant_b_material, tenant_b)

    async with database_engine.connect() as connection:
        active_tenants = (
            (
                await connection.execute(
                    text(
                        """
                    SELECT tenant_id
                    FROM ai.material_version
                    WHERE state = 'ACTIVE'
                    ORDER BY tenant_id
                    """
                    )
                )
            )
            .scalars()
            .all()
        )
    assert active_tenants == ["tenant-a", "tenant-b"]


async def test_key_terms_are_stored_and_upserted_for_a_material_version(
    repository: PgvectorIndexRepository,
    key_term_repository: PgvectorKeyTermRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(1)
    version_id = await repository.stage(material, [_chunk(0.1)])
    await repository.activate(material, version_id)

    await key_term_repository.store(
        version_id,
        [
            KeyTerm(term="지도학습", definition="정답이 있는 데이터로 학습하는 방식"),
            KeyTerm(term="비지도학습", definition="정답 없이 패턴을 찾는 방식"),
        ],
    )

    async with database_engine.connect() as connection:
        rows = (
            await connection.execute(
                text(
                    """
                        SELECT term, definition
                        FROM ai.material_key_term
                        WHERE material_version_id = :version_id
                        """
                ),
                {"version_id": version_id},
            )
        ).all()
    assert dict(rows) == {
        "지도학습": "정답이 있는 데이터로 학습하는 방식",
        "비지도학습": "정답 없이 패턴을 찾는 방식",
    }

    await key_term_repository.store(
        version_id,
        [KeyTerm(term="지도학습", definition="갱신된 정의")],
    )

    async with database_engine.connect() as connection:
        updated_definition = await connection.scalar(
            text(
                """
                SELECT definition FROM ai.material_key_term
                WHERE material_version_id = :version_id AND term = '지도학습'
                """
            ),
            {"version_id": version_id},
        )
        remaining_count = await connection.scalar(
            text(
                "SELECT count(*) FROM ai.material_key_term WHERE material_version_id = :version_id"
            ),
            {"version_id": version_id},
        )
    assert updated_definition == "갱신된 정의"
    assert remaining_count == 2


async def test_key_terms_cascade_delete_with_their_material_version(
    repository: PgvectorIndexRepository,
    key_term_repository: PgvectorKeyTermRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(1)
    version_id = await repository.stage(material, [_chunk(0.1)])
    await repository.activate(material, version_id)
    await key_term_repository.store(
        version_id,
        [KeyTerm(term="지도학습", definition="정답이 있는 데이터로 학습하는 방식")],
    )

    deleted = replace(
        _material(2),
        job_id="job-delete-key-terms",
        idempotency_key="material-key-terms-delete",
    )
    assert await repository.delete_job(deleted) == 1

    async with database_engine.connect() as connection:
        remaining = await connection.scalar(
            text(
                "SELECT count(*) FROM ai.material_key_term WHERE material_version_id = :version_id"
            ),
            {"version_id": version_id},
        )
    assert remaining == 0


async def test_resolve_active_scope_returns_none_when_never_indexed(
    repository: PgvectorIndexRepository,
) -> None:
    assert await repository.resolve_active_scope("tenant-test", MATERIAL_ID) is None


async def test_resolve_active_scope_recovers_curriculum_id_and_current_version(
    repository: PgvectorIndexRepository,
) -> None:
    first = _material(1)
    second = _material(2)
    await repository.activate(first, await repository.stage(first, [_chunk(0.1)]))
    await repository.stage(second, [_chunk(0.2)])

    scope = await repository.resolve_active_scope("tenant-test", MATERIAL_ID)

    assert scope is not None
    assert scope.curriculum_id == CURRICULUM_ID
    assert scope.lesson_id == LESSON_ID
    assert scope.material_version == 2


async def test_resolve_active_scope_then_delete_job_removes_the_material(
    repository: PgvectorIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    material = _material(1)
    await repository.activate(material, await repository.stage(material, [_chunk(0.1)]))

    scope = await repository.resolve_active_scope("tenant-test", MATERIAL_ID)
    assert scope is not None

    deleted = replace(
        _material(scope.material_version),
        curriculum_id=scope.curriculum_id,
        lesson_id=scope.lesson_id,
        job_id="job-delete-resolved",
        idempotency_key="material-delete-resolved",
    )
    assert await repository.delete_job(deleted) == 1
    assert await repository.resolve_active_scope("tenant-test", MATERIAL_ID) is None

    async with database_engine.connect() as connection:
        remaining = await connection.scalar(text("SELECT count(*) FROM ai.material_version"))
    assert remaining == 0


def _annotation(
    *,
    highlight_id: UUID,
    text_value: str = "B+ tree 노드 분할 조건",
    session_ms: int = 725_300,
    first: float = 1.0,
) -> AnnotationRecord:
    return AnnotationRecord(
        highlight_id=highlight_id,
        curriculum_id=CURRICULUM_ID,
        lesson_id=LESSON_ID,
        session_id=UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        session_ms=session_ms,
        captured_at=datetime(2026, 8, 4, 4, 20, 5, tzinfo=timezone.utc),
        text=text_value,
        embedding=tuple([first] + [0.0] * (BGE_M3_DIMENSIONS - 1)),
    )


ANNOTATION_SNAPSHOT_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")


async def test_annotation_highlight_is_stored_as_one_searchable_row(
    annotation_repository: PgvectorAnnotationIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    await annotation_repository.upsert(_annotation(highlight_id=ANNOTATION_SNAPSHOT_ID))

    async with database_engine.connect() as connection:
        row = (
            (
                await connection.execute(
                    text(
                        """
                    SELECT session_ms, text, state,
                           search_vector IS NOT NULL AS indexed
                    FROM ai.annotation_highlight
                    WHERE highlight_id = :highlight_id
                    """
                    ),
                    {"highlight_id": str(ANNOTATION_SNAPSHOT_ID)},
                )
            )
            .mappings()
            .one()
        )

    assert row["session_ms"] == 725_300
    assert row["text"] == "B+ tree 노드 분할 조건"
    assert row["state"] == "ACTIVE"
    assert row["indexed"] is True


async def test_reindexing_the_same_highlight_replaces_it_instead_of_duplicating(
    annotation_repository: PgvectorAnnotationIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    """highlight_id is the idempotency key: a redelivered job must not double the evidence."""
    await annotation_repository.upsert(
        _annotation(highlight_id=ANNOTATION_SNAPSHOT_ID, text_value="처음 해석")
    )
    await annotation_repository.upsert(
        _annotation(
            highlight_id=ANNOTATION_SNAPSHOT_ID,
            text_value="다시 읽은 해석",
            session_ms=800_000,
        )
    )

    async with database_engine.connect() as connection:
        rows = (
            (
                await connection.execute(
                    text(
                        "SELECT text, session_ms FROM ai.annotation_highlight "
                        "WHERE highlight_id = :highlight_id"
                    ),
                    {"highlight_id": str(ANNOTATION_SNAPSHOT_ID)},
                )
            )
            .mappings()
            .all()
        )

    assert len(rows) == 1
    assert rows[0]["text"] == "다시 읽은 해석"
    assert rows[0]["session_ms"] == 800_000


async def test_withdrawing_a_highlight_is_idempotent_and_keeps_the_row(
    annotation_repository: PgvectorAnnotationIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    await annotation_repository.upsert(_annotation(highlight_id=ANNOTATION_SNAPSHOT_ID))

    await annotation_repository.mark_deleted(ANNOTATION_SNAPSHOT_ID)
    await annotation_repository.mark_deleted(ANNOTATION_SNAPSHOT_ID)

    async with database_engine.connect() as connection:
        state = await connection.scalar(
            text("SELECT state FROM ai.annotation_highlight WHERE highlight_id = :highlight_id"),
            {"highlight_id": str(ANNOTATION_SNAPSHOT_ID)},
        )
    assert state == "DELETED"


async def test_withdrawing_a_snapshot_that_was_never_indexed_succeeds(
    annotation_repository: PgvectorAnnotationIndexRepository,
) -> None:
    await annotation_repository.mark_deleted(UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"))


async def test_reindexing_a_withdrawn_highlight_brings_it_back(
    annotation_repository: PgvectorAnnotationIndexRepository,
    database_engine: AsyncEngine,
) -> None:
    """The instructor putting a highlight back must not need a new snapshot id."""
    await annotation_repository.upsert(_annotation(highlight_id=ANNOTATION_SNAPSHOT_ID))
    await annotation_repository.mark_deleted(ANNOTATION_SNAPSHOT_ID)

    await annotation_repository.upsert(_annotation(highlight_id=ANNOTATION_SNAPSHOT_ID))

    async with database_engine.connect() as connection:
        state = await connection.scalar(
            text("SELECT state FROM ai.annotation_highlight WHERE highlight_id = :highlight_id"),
            {"highlight_id": str(ANNOTATION_SNAPSHOT_ID)},
        )
    assert state == "ACTIVE"


@pytest.mark.parametrize(
    "embedding",
    [
        tuple([1.0] * (BGE_M3_DIMENSIONS - 1)),
        tuple([0.0] * BGE_M3_DIMENSIONS),
        tuple([float("nan")] + [0.0] * (BGE_M3_DIMENSIONS - 1)),
    ],
)
async def test_rejects_an_embedding_that_cannot_be_ranked(
    annotation_repository: PgvectorAnnotationIndexRepository,
    embedding: tuple[float, ...],
) -> None:
    record = replace(_annotation(highlight_id=ANNOTATION_SNAPSHOT_ID), embedding=embedding)

    with pytest.raises(AnnotationIngestionError):
        await annotation_repository.upsert(record)
