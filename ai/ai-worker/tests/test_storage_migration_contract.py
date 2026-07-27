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
