from __future__ import annotations

import hashlib
import math
import re
import struct
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.domain import (
    BGE_M3_DIMENSIONS,
    ChunkRecord,
    ExistingIndexVersion,
    MaterialScope,
    StagedMaterial,
    StaleMaterialVersionError,
)


_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class PgvectorIndexRepository:
    """Persist a complete inactive version, then switch the active pointer separately."""

    def __init__(self, engine: AsyncEngine, *, runtime_role: str = "ai_app") -> None:
        if not _DATABASE_ROLE.fullmatch(runtime_role):
            raise ValueError("runtime_role must be a safe PostgreSQL role identifier")
        self._engine = engine
        self._set_runtime_role = text(f"SET LOCAL ROLE {runtime_role}")

    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None:
        """Resume a staged version or return a completed result without re-embedding."""

        values = asdict(material)
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            rows = (
                (
                    await connection.execute(
                        text(
                            """
                            SELECT
                              jr.job_id, jr.idempotency_key, jr.task_type, jr.tenant_id,
                              jr.curriculum_id, jr.lesson_id, jr.material_id,
                              jr.material_version, jr.status, jr.correlation_id,
                              mv.id AS version_id, mv.state, mv.source_bucket,
                              mv.source_object_key, mv.chunk_strategy,
                              model.model_name, model.model_revision
                            FROM ai.job_run jr
                            LEFT JOIN ai.material_version mv ON mv.job_run_id = jr.id
                            LEFT JOIN LATERAL (
                              SELECT ce.model_name, ce.model_revision
                              FROM ai.document_chunk dc
                              JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id
                              WHERE dc.material_version_id = mv.id
                              ORDER BY dc.chunk_index
                              LIMIT 1
                            ) model ON true
                            WHERE jr.job_id = :job_id
                               OR jr.idempotency_key = :idempotency_key
                            ORDER BY jr.id
                            """
                        ),
                        values,
                    )
                )
                .mappings()
                .all()
            )

        if not rows:
            return None
        if len(rows) != 1:
            raise ValueError("job identity keys refer to different material operations")

        existing = rows[0]
        _assert_job_identity(
            existing,
            {
                "job_id": material.job_id,
                "idempotency_key": material.idempotency_key,
                "task_type": "MATERIAL_INDEX",
                "tenant_id": material.tenant_id,
                "curriculum_id": material.curriculum_id,
                "lesson_id": material.lesson_id,
                "material_id": material.material_id,
                "material_version": material.material_version,
                "correlation_id": material.correlation_id,
            },
        )
        if existing["version_id"] is None:
            raise ValueError("material index job exists without a staged version")
        _assert_job_identity(
            existing,
            {
                "source_bucket": material.source_bucket,
                "source_object_key": material.source_object_key,
                "chunk_strategy": material.chunk_strategy,
                "model_name": material.model_name,
                "model_revision": material.model_revision,
            },
        )

        version_id = int(existing["version_id"])
        if existing["status"] == "SUCCEEDED" and existing["state"] in {"ACTIVE", "RETIRED"}:
            return ExistingIndexVersion(version_id, activation_required=False)
        if existing["status"] == "RUNNING" and existing["state"] == "BUILDING":
            return ExistingIndexVersion(version_id, activation_required=True)
        raise ValueError("stored material index job has an inconsistent terminal state")

    async def stage(self, material: StagedMaterial, chunks: Sequence[ChunkRecord]) -> int:
        if not chunks:
            raise ValueError("at least one chunk is required")
        if len({chunk.chunk_index for chunk in chunks}) != len(chunks):
            raise ValueError("chunk_index values must be unique within a material version")

        values = {**asdict(material), "input_fingerprint": _chunk_fingerprint(chunks)}
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            await _lock_material(connection, material.tenant_id, material.material_id)
            await _assert_material_scope(connection, material)
            delete_version = await connection.scalar(
                text(
                    """
                    SELECT max(material_version)
                    FROM ai.job_run
                    WHERE tenant_id = :tenant_id AND material_id = :material_id
                      AND task_type = 'MATERIAL_DELETE' AND status = 'SUCCEEDED'
                    """
                ),
                values,
            )
            if delete_version is not None and delete_version >= material.material_version:
                raise StaleMaterialVersionError(
                    "index operation is not newer than the completed delete version"
                )

            existing_version = await _find_material_version(connection, values)
            if existing_version is not None:
                _assert_staged_identity(existing_version, material, values["input_fingerprint"])
                if existing_version["state"] == "FAILED":
                    raise ValueError("failed material version requires a higher material_version")
                return int(existing_version["version_id"])

            newest_version = await connection.scalar(
                text(
                    """
                    SELECT max(material_version)
                    FROM ai.material_version
                    WHERE tenant_id = :tenant_id
                      AND material_id = :material_id
                      AND state <> 'FAILED'
                    """
                ),
                values,
            )
            if newest_version is not None and newest_version > material.material_version:
                raise StaleMaterialVersionError(
                    "index operation is older than the newest stored material version"
                )

            job_run_id = await _start_job_run(connection, material, "MATERIAL_INDEX")
            if job_run_id is None:
                existing = (
                    (
                        await connection.execute(
                            text(
                                """
                            SELECT
                              jr.id, jr.tenant_id, jr.curriculum_id, jr.lesson_id,
                              jr.material_id, jr.material_version, jr.correlation_id,
                              mv.id AS version_id, mv.source_bucket, mv.source_object_key,
                              mv.chunk_strategy, mv.input_fingerprint,
                              ce.model_name, ce.model_revision
                            FROM ai.job_run jr
                            JOIN ai.material_version mv ON mv.job_run_id = jr.id
                            JOIN ai.document_chunk dc ON dc.material_version_id = mv.id
                            JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id
                            WHERE jr.job_id = :job_id
                              AND jr.idempotency_key = :idempotency_key
                            LIMIT 1
                            """
                            ),
                            values,
                        )
                    )
                    .mappings()
                    .one_or_none()
                )
                _assert_job_identity(
                    existing,
                    {
                        "tenant_id": material.tenant_id,
                        "curriculum_id": material.curriculum_id,
                        "lesson_id": material.lesson_id,
                        "material_id": material.material_id,
                        "material_version": material.material_version,
                        "correlation_id": material.correlation_id,
                        "source_bucket": material.source_bucket,
                        "source_object_key": material.source_object_key,
                        "chunk_strategy": material.chunk_strategy,
                        "input_fingerprint": values["input_fingerprint"],
                        "model_name": material.model_name,
                        "model_revision": material.model_revision,
                    },
                )
                return int(existing["version_id"])

            model_run_id = await connection.scalar(
                text(
                    """
                    INSERT INTO ai.model_run (
                      task_type, provider, model_name, model_revision, dimensions, status,
                      correlation_id, ended_at
                    ) VALUES (
                      'EMBED', 'local', :model_name, :model_revision, :dimensions,
                      'SUCCEEDED', :correlation_id, now()
                    )
                    RETURNING id
                    """
                ),
                {**values, "dimensions": BGE_M3_DIMENSIONS},
            )
            version_id = await connection.scalar(
                text(
                    """
                    INSERT INTO ai.material_version (
                      tenant_id, curriculum_id, lesson_id, material_id, material_version,
                      state, source_bucket, source_object_key, chunk_strategy,
                      input_fingerprint, job_run_id
                    ) VALUES (
                      :tenant_id, :curriculum_id, :lesson_id, :material_id,
                      :material_version, 'BUILDING', :source_bucket, :source_object_key,
                      :chunk_strategy, :input_fingerprint, :job_run_id
                    )
                    RETURNING id
                    """
                ),
                {**values, "job_run_id": job_run_id},
            )
            for chunk in chunks:
                normalized_embedding = _normalize_vector(chunk.embedding)
                chunk_id = await connection.scalar(
                    text(
                        """
                        INSERT INTO ai.document_chunk (
                          material_version_id, chunk_index, page, text, content_hash
                        ) VALUES (
                          :version_id, :chunk_index, :page, :text, :content_hash
                        )
                        RETURNING id
                        """
                    ),
                    {**asdict(chunk), "version_id": version_id},
                )
                await connection.execute(
                    text(
                        """
                        INSERT INTO ai.chunk_embedding (
                          chunk_id, model_run_id, model_name, model_revision, embedding
                        ) VALUES (
                          :chunk_id, :model_run_id, :model_name, :model_revision,
                          CAST(:embedding AS vector)
                        )
                        """
                    ),
                    {
                        "chunk_id": chunk_id,
                        "model_run_id": model_run_id,
                        "model_name": material.model_name,
                        "model_revision": material.model_revision,
                        "embedding": _vector_literal(normalized_embedding),
                    },
                )
            return int(version_id)

    async def activate(self, material: StagedMaterial, version_id: int) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            target = await _load_version_identity(connection, version_id)
            _assert_version_identity(target, material)
            await _lock_material(connection, target["tenant_id"], target["material_id"])
            target = await _load_version_identity(connection, version_id, for_update=True)
            _assert_version_identity(target, material)
            if target["state"] == "ACTIVE":
                return
            if target["state"] != "BUILDING":
                raise ValueError("only a BUILDING material version can be activated")

            newest_version = await connection.scalar(
                text(
                    """
                    SELECT max(material_version)
                    FROM ai.material_version
                    WHERE tenant_id = :tenant_id
                      AND material_id = :material_id
                      AND state <> 'FAILED'
                    """
                ),
                target,
            )
            target_version = target["material_version"]
            if newest_version is not None and newest_version > target_version:
                raise StaleMaterialVersionError("a newer material version is already stored")

            await connection.execute(
                text(
                    """
                    UPDATE ai.material_version
                    SET state = 'RETIRED', retired_at = now()
                    WHERE tenant_id = :tenant_id
                      AND material_id = :material_id
                      AND state = 'ACTIVE'
                    """
                ),
                target,
            )
            await connection.execute(
                text(
                    """
                    UPDATE ai.material_version
                    SET state = 'ACTIVE', activated_at = now()
                    WHERE id = :version_id
                    """
                ),
                {"version_id": version_id},
            )
            await connection.execute(
                text(
                    """
                    UPDATE ai.job_run
                    SET status = 'SUCCEEDED', ended_at = now(), updated_at = now()
                    WHERE id = (
                      SELECT job_run_id FROM ai.material_version WHERE id = :version_id
                    )
                    """
                ),
                {"version_id": version_id},
            )

    async def resolve_active_scope(self, tenant_id: str, material_id: UUID) -> MaterialScope | None:
        """Recover a material's invariant scope and current version by identity alone.

        Lets a delete request that only carries materialId/lessonId (ADR-0006) still pass
        curriculum_id and the current material_version into delete_job's scope check, without
        Spring adding curriculum_id to the EMBED_DELETE wire payload.
        """

        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            row = (
                (
                    await connection.execute(
                        text(
                            """
                            SELECT curriculum_id, lesson_id,
                                   max(material_version) AS material_version
                            FROM ai.material_version
                            WHERE tenant_id = :tenant_id AND material_id = :material_id
                            GROUP BY curriculum_id, lesson_id
                            """
                        ),
                        {"tenant_id": tenant_id, "material_id": material_id},
                    )
                )
                .mappings()
                .one_or_none()
            )
        if row is None:
            return None
        return MaterialScope(
            curriculum_id=row["curriculum_id"],
            lesson_id=row["lesson_id"],
            material_version=int(row["material_version"]),
        )

    async def delete_job(self, material: StagedMaterial) -> int:
        """Delete a material index while retaining an idempotent version tombstone."""

        values = asdict(material)
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            await _lock_material(connection, material.tenant_id, material.material_id)
            await _assert_material_scope(connection, material)
            job_run_id = await _start_job_run(connection, material, "MATERIAL_DELETE")
            if job_run_id is None:
                existing = (
                    (
                        await connection.execute(
                            text(
                                """
                            SELECT id, task_type, tenant_id, curriculum_id, lesson_id,
                                   material_id, material_version, correlation_id, status
                            FROM ai.job_run
                            WHERE job_id = :job_id AND idempotency_key = :idempotency_key
                            """
                            ),
                            values,
                        )
                    )
                    .mappings()
                    .one_or_none()
                )
                _assert_job_identity(
                    existing,
                    {
                        "task_type": "MATERIAL_DELETE",
                        "tenant_id": material.tenant_id,
                        "curriculum_id": material.curriculum_id,
                        "lesson_id": material.lesson_id,
                        "material_id": material.material_id,
                        "material_version": material.material_version,
                        "correlation_id": material.correlation_id,
                    },
                )
                if existing["status"] == "SUCCEEDED":
                    return 0
                if existing["status"] in {"FAILED", "CANCELLED"}:
                    raise ValueError("terminal delete job requires a new job identity")
                job_run_id = existing["id"]

            newest_version = await connection.scalar(
                text(
                    """
                    SELECT max(material_version)
                    FROM ai.material_version
                    WHERE tenant_id = :tenant_id AND material_id = :material_id
                    """
                ),
                values,
            )
            if newest_version is not None and newest_version > material.material_version:
                raise StaleMaterialVersionError(
                    "delete operation is older than the stored material version"
                )
            await connection.execute(
                text(
                    """
                    UPDATE ai.job_run
                    SET status = 'CANCELLED', ended_at = now(), updated_at = now()
                    WHERE status = 'RUNNING'
                      AND task_type = 'MATERIAL_INDEX'
                      AND id IN (
                        SELECT job_run_id
                        FROM ai.material_version
                        WHERE tenant_id = :tenant_id AND material_id = :material_id
                      )
                    """
                ),
                values,
            )
            result = await connection.execute(
                text(
                    """
                    DELETE FROM ai.material_version
                    WHERE tenant_id = :tenant_id AND material_id = :material_id
                    """
                ),
                values,
            )
            await connection.execute(
                text(
                    """
                    UPDATE ai.job_run
                    SET status = 'SUCCEEDED', ended_at = now(), updated_at = now()
                    WHERE id = :job_run_id
                    """
                ),
                {"job_run_id": job_run_id},
            )
            return result.rowcount


async def _start_job_run(connection, material: StagedMaterial, task_type: str) -> int | None:
    job_run_id = await connection.scalar(
        text(
            """
            INSERT INTO ai.job_run (
              job_id, idempotency_key, task_type, tenant_id, curriculum_id, lesson_id,
              material_id, material_version, status, correlation_id
            ) VALUES (
              :job_id, :idempotency_key, :task_type, :tenant_id, :curriculum_id,
              :lesson_id, :material_id, :material_version, 'RUNNING', :correlation_id
            )
            ON CONFLICT DO NOTHING
            RETURNING id
            """
        ),
        {**asdict(material), "task_type": task_type},
    )
    return None if job_run_id is None else int(job_run_id)


def _assert_job_identity(
    existing: Mapping[str, object] | None,
    expected: Mapping[str, object],
) -> None:
    if existing is None or any(existing[field] != value for field, value in expected.items()):
        raise ValueError("job identity was reused with a different material operation")


async def _find_material_version(
    connection: AsyncConnection,
    values: Mapping[str, object],
) -> Mapping[str, object] | None:
    return (
        (
            await connection.execute(
                text(
                    """
                SELECT
                  mv.id AS version_id, mv.state, mv.tenant_id, mv.curriculum_id,
                  mv.lesson_id, mv.material_id, mv.material_version, mv.source_bucket,
                  mv.source_object_key, mv.chunk_strategy, mv.input_fingerprint,
                  jr.job_id, jr.idempotency_key, jr.task_type, jr.correlation_id,
                  ce.model_name, ce.model_revision
                FROM ai.material_version mv
                JOIN ai.job_run jr ON jr.id = mv.job_run_id
                JOIN ai.document_chunk dc ON dc.material_version_id = mv.id
                JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id
                WHERE mv.tenant_id = :tenant_id
                  AND mv.material_id = :material_id
                  AND mv.material_version = :material_version
                LIMIT 1
                """
                ),
                values,
            )
        )
        .mappings()
        .one_or_none()
    )


def _assert_staged_identity(
    existing: Mapping[str, object],
    material: StagedMaterial,
    input_fingerprint: object,
) -> None:
    _assert_job_identity(
        existing,
        {
            "job_id": material.job_id,
            "idempotency_key": material.idempotency_key,
            "task_type": "MATERIAL_INDEX",
            "tenant_id": material.tenant_id,
            "curriculum_id": material.curriculum_id,
            "lesson_id": material.lesson_id,
            "material_id": material.material_id,
            "material_version": material.material_version,
            "correlation_id": material.correlation_id,
            "source_bucket": material.source_bucket,
            "source_object_key": material.source_object_key,
            "chunk_strategy": material.chunk_strategy,
            "input_fingerprint": input_fingerprint,
            "model_name": material.model_name,
            "model_revision": material.model_revision,
        },
    )


async def _load_version_identity(
    connection: AsyncConnection,
    version_id: int,
    *,
    for_update: bool = False,
) -> Mapping[str, object]:
    locking_clause = "FOR UPDATE OF mv" if for_update else ""
    return (
        (
            await connection.execute(
                text(
                    f"""
                SELECT
                  mv.tenant_id, mv.curriculum_id, mv.lesson_id, mv.material_id,
                  mv.material_version, mv.state, mv.source_bucket, mv.source_object_key,
                  mv.chunk_strategy, jr.job_id, jr.idempotency_key, jr.correlation_id,
                  ce.model_name, ce.model_revision
                FROM ai.material_version mv
                JOIN ai.job_run jr ON jr.id = mv.job_run_id
                JOIN ai.document_chunk dc ON dc.material_version_id = mv.id
                JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id
                WHERE mv.id = :version_id
                LIMIT 1
                {locking_clause}
                """
                ),
                {"version_id": version_id},
            )
        )
        .mappings()
        .one()
    )


def _assert_version_identity(
    existing: Mapping[str, object],
    material: StagedMaterial,
) -> None:
    _assert_job_identity(
        existing,
        {
            "job_id": material.job_id,
            "idempotency_key": material.idempotency_key,
            "tenant_id": material.tenant_id,
            "curriculum_id": material.curriculum_id,
            "lesson_id": material.lesson_id,
            "material_id": material.material_id,
            "material_version": material.material_version,
            "correlation_id": material.correlation_id,
            "source_bucket": material.source_bucket,
            "source_object_key": material.source_object_key,
            "chunk_strategy": material.chunk_strategy,
            "model_name": material.model_name,
            "model_revision": material.model_revision,
        },
    )


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(format(float(value), ".9g") for value in values) + "]"


def _normalize_vector(values: Sequence[float]) -> list[float]:
    numeric_values = [float(value) for value in values]
    if len(numeric_values) != BGE_M3_DIMENSIONS:
        raise ValueError(f"BGE-M3 embeddings must contain exactly {BGE_M3_DIMENSIONS} values")
    if not all(math.isfinite(value) for value in numeric_values):
        raise ValueError("embedding must be a finite non-zero vector")
    norm = math.hypot(*numeric_values)
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("embedding must be a finite non-zero vector")
    return [value / norm for value in numeric_values]


def _chunk_fingerprint(chunks: Sequence[ChunkRecord]) -> str:
    digest = hashlib.sha256()
    for chunk in sorted(chunks, key=lambda item: item.chunk_index):
        digest.update(struct.pack("!ii", chunk.chunk_index, chunk.page))
        for value in (chunk.text, chunk.content_hash):
            encoded = value.encode("utf-8")
            digest.update(struct.pack("!I", len(encoded)))
            digest.update(encoded)
        for value in _normalize_vector(chunk.embedding):
            digest.update(struct.pack("!d", value))
    return digest.hexdigest()


async def _lock_material(connection, tenant_id: str, material_id: UUID) -> None:
    await connection.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:material_key, 0))"),
        {"material_key": f"{tenant_id}:{material_id}"},
    )


async def _assert_material_scope(connection, material: StagedMaterial) -> None:
    scope_mismatch = await connection.scalar(
        text(
            """
            -- IS DISTINCT FROM, not <>: a curriculum-scoped material has lesson_id NULL, and
            -- `NULL <> x` is NULL rather than true, so plain <> would silently pass a material
            -- moving between lesson and curriculum scope — the one thing this guard exists to
            -- stop (CONTRACT §1: a material identity's scope is invariant).
            SELECT EXISTS (
              SELECT 1
              FROM ai.material_version
              WHERE tenant_id = :tenant_id
                AND material_id = :material_id
                AND (
                  curriculum_id IS DISTINCT FROM :curriculum_id
                  OR lesson_id IS DISTINCT FROM :lesson_id
                )
              UNION ALL
              SELECT 1
              FROM ai.job_run
              WHERE tenant_id = :tenant_id
                AND material_id = :material_id
                AND (
                  curriculum_id IS DISTINCT FROM :curriculum_id
                  OR lesson_id IS DISTINCT FROM :lesson_id
                )
            )
            """
        ),
        asdict(material),
    )
    if scope_mismatch:
        raise ValueError("material identity cannot move to another curriculum or lesson")
