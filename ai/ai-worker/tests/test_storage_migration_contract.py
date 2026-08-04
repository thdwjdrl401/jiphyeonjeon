import importlib

import pytest


def test_upgrade_uses_curriculum_uuid_pgvector_and_least_privilege(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0001_rag_index_storage")
    monkeypatch.delenv("AI_WORKER_DATABASE_ROLE", raising=False)
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()
    ddl = "\n".join(str(statement) for statement in statements)

    assert "curriculum_id uuid NOT NULL" in ddl
    assert "course_id" not in ddl
    assert "lesson_id uuid NOT NULL" in ddl
    assert "material_id uuid NOT NULL" in ddl
    assert "embedding vector(1024) NOT NULL" in ddl
    assert "embedding vector_cosine_ops" in ddl
    assert "WHERE state = 'ACTIVE'" in ddl
    assert "input_fingerprint varchar(64) NOT NULL" in ddl
    assert "'CANCELLED'" in ddl
    assert "ix_job_run_material_order" in ddl
    assert "REVOKE CREATE ON SCHEMA ai FROM ai_app" in ddl
    assert "has_schema_privilege('ai_app', 'ai', 'CREATE')" in ddl
    assert "direct or inherited CREATE" in ddl
    assert "ON SCHEMA core" not in ddl
    assert "must be provisioned before the AI migration" in ddl
    assert "must be an unprivileged NOLOGIN NOINHERIT role" in ddl
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in ddl
    assert "ON ALL TABLES" not in ddl
    assert "ALTER DEFAULT PRIVILEGES" not in ddl
    assert migration.revision == "0001_rag_index_storage"
    assert migration.down_revision is None


def test_downgrade_removes_only_owned_tables(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0001_rag_index_storage")
    monkeypatch.delenv("AI_WORKER_DATABASE_ROLE", raising=False)
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()
    ddl = "\n".join(str(statement) for statement in statements)

    assert ddl.index("chunk_embedding") < ddl.index("document_chunk")
    assert ddl.index("document_chunk") < ddl.index("material_version")
    assert ddl.index("material_version") < ddl.index("model_run")
    assert ddl.index("model_run") < ddl.index("job_run")
    assert "DROP SCHEMA" not in ddl
    assert "DROP EXTENSION" not in ddl
    assert "DROP ROLE" not in ddl


def test_upgrade_rejects_unsafe_runtime_role_before_executing_sql(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0001_rag_index_storage")
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)
    monkeypatch.setenv("AI_WORKER_DATABASE_ROLE", "ai_app; RESET ROLE")

    with pytest.raises(ValueError, match="safe PostgreSQL role"):
        migration.upgrade()

    assert statements == []


def test_key_term_storage_is_versioned_and_runtime_writable(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0002_material_key_terms")
    monkeypatch.delenv("AI_WORKER_DATABASE_ROLE", raising=False)
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()
    ddl = "\n".join(str(statement) for statement in statements)

    assert "CREATE TABLE ai.material_key_term" in ddl
    assert "material_version_id bigint NOT NULL" in ddl
    assert "REFERENCES ai.material_version(id) ON DELETE CASCADE" in ddl
    assert "PRIMARY KEY (material_version_id, term)" in ddl
    assert "definition text NOT NULL" in ddl
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in ddl
    assert migration.revision == "0002_material_key_terms"
    assert migration.down_revision == "0001_rag_index_storage"


def test_key_term_storage_downgrade_drops_only_its_own_table(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0002_material_key_terms")
    monkeypatch.delenv("AI_WORKER_DATABASE_ROLE", raising=False)
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()
    ddl = "\n".join(str(statement) for statement in statements)

    assert "DROP TABLE IF EXISTS ai.material_key_term" in ddl
    assert "DROP SCHEMA" not in ddl


def test_key_term_storage_upgrade_rejects_unsafe_runtime_role_before_executing_sql(
    monkeypatch,
) -> None:
    migration = importlib.import_module("migrations.versions.0002_material_key_terms")
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)
    monkeypatch.setenv("AI_WORKER_DATABASE_ROLE", "ai_app; RESET ROLE")

    with pytest.raises(ValueError, match="safe PostgreSQL role"):
        migration.upgrade()

    assert statements == []


def test_annotation_snapshot_stores_timeline_anchored_evidence(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0003_annotation_snapshot")
    monkeypatch.delenv("AI_WORKER_DATABASE_ROLE", raising=False)
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()
    ddl = "\n".join(str(statement) for statement in statements)

    assert "CREATE TABLE ai.annotation_snapshot" in ddl
    # snapshotId is the ADR-0043 idempotency key: re-published jobs must replace, not duplicate.
    assert "snapshot_id uuid NOT NULL UNIQUE" in ddl
    # curriculum_id is the search scope axis, session_id/session_ms the replay anchor.
    assert "curriculum_id uuid NOT NULL" in ddl
    assert "session_id uuid NOT NULL" in ddl
    assert "session_ms bigint NOT NULL CHECK (session_ms >= 0)" in ddl
    assert "text_origin varchar(16) NOT NULL CHECK (text_origin IN ('SPRING', 'MODEL'))" in ddl
    assert "state varchar(16) NOT NULL CHECK (state IN ('ACTIVE', 'DELETED'))" in ddl
    # Same embedding contract as material chunks so both can be ranked together.
    assert "embedding vector(1024) NOT NULL" in ddl
    assert "embedding vector_cosine_ops" in ddl
    # search_vector is generated, never written by the app, so it cannot drift from text.
    assert "GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED" in ddl
    assert "ix_annotation_snapshot_scope" in ddl
    assert "ix_annotation_snapshot_timeline" in ddl
    assert "ix_annotation_snapshot_fts" in ddl
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in ddl
    assert "ON ALL TABLES" not in ddl
    assert "ALTER DEFAULT PRIVILEGES" not in ddl
    assert migration.revision == "0003_annotation_snapshot"
    assert migration.down_revision == "0002_material_key_terms"


def test_annotation_snapshot_downgrade_drops_only_its_own_table(monkeypatch) -> None:
    migration = importlib.import_module("migrations.versions.0003_annotation_snapshot")
    monkeypatch.delenv("AI_WORKER_DATABASE_ROLE", raising=False)
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()
    ddl = "\n".join(str(statement) for statement in statements)

    assert "DROP TABLE IF EXISTS ai.annotation_snapshot" in ddl
    assert "DROP SCHEMA" not in ddl
    assert "DROP EXTENSION" not in ddl
    assert "material_version" not in ddl


def test_annotation_snapshot_upgrade_rejects_unsafe_runtime_role_before_executing_sql(
    monkeypatch,
) -> None:
    migration = importlib.import_module("migrations.versions.0003_annotation_snapshot")
    statements = []
    monkeypatch.setattr(migration.op, "execute", statements.append)
    monkeypatch.setenv("AI_WORKER_DATABASE_ROLE", "ai_app; RESET ROLE")

    with pytest.raises(ValueError, match="safe PostgreSQL role"):
        migration.upgrade()

    assert statements == []
