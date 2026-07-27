"""Create the Python-owned RAG index storage."""

import os
import re

from alembic import op


revision = "0001_rag_index_storage"
down_revision = None
branch_labels = None
depends_on = None

_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _runtime_role() -> str:
    role = os.getenv("AI_WORKER_DATABASE_ROLE", "ai_app")
    if not _DATABASE_ROLE.fullmatch(role):
        raise ValueError("AI_WORKER_DATABASE_ROLE must be a safe PostgreSQL role identifier")
    return role


def upgrade() -> None:
    runtime_role = _runtime_role()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE SCHEMA IF NOT EXISTS ai")
    op.execute(
        f"""
        DO $$
        DECLARE
          runtime_role record;
        BEGIN
          SELECT * INTO runtime_role FROM pg_roles WHERE rolname = '{runtime_role}';
          IF NOT FOUND THEN
            RAISE EXCEPTION 'ai_app must be provisioned before the AI migration';
          END IF;
          IF runtime_role.rolcanlogin
             OR runtime_role.rolsuper
             OR runtime_role.rolinherit
             OR runtime_role.rolcreaterole
             OR runtime_role.rolcreatedb
             OR runtime_role.rolreplication
             OR runtime_role.rolbypassrls THEN
            RAISE EXCEPTION 'ai_app must be an unprivileged NOLOGIN NOINHERIT role';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM pg_auth_members membership
            JOIN pg_roles member_role ON member_role.oid = membership.member
            WHERE member_role.rolname = '{runtime_role}'
          ) THEN
            RAISE EXCEPTION 'ai_app must not inherit or SET ROLE to another role';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM pg_namespace namespace
            JOIN pg_roles owner_role ON owner_role.oid = namespace.nspowner
            WHERE namespace.nspname = 'ai' AND owner_role.rolname = '{runtime_role}'
          ) THEN
            RAISE EXCEPTION 'ai_app must not own the ai schema';
          END IF;
        END $$
        """
    )
    op.execute(f"REVOKE CREATE ON SCHEMA ai FROM {runtime_role}")
    op.execute(
        f"""
        DO $$ BEGIN
          IF has_schema_privilege('{runtime_role}', 'ai', 'CREATE') THEN
            RAISE EXCEPTION 'ai_app must not have direct or inherited CREATE on ai schema';
          END IF;
        END $$
        """
    )
    op.execute(f"GRANT USAGE ON SCHEMA ai TO {runtime_role}")
    op.execute(
        """
        CREATE TABLE ai.job_run (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          job_id varchar(128) NOT NULL UNIQUE,
          idempotency_key varchar(256) NOT NULL UNIQUE,
          task_type varchar(32) NOT NULL
            CHECK (task_type IN ('MATERIAL_INDEX', 'MATERIAL_DELETE')),
          tenant_id varchar(128) NOT NULL,
          curriculum_id uuid NOT NULL,
          lesson_id uuid NOT NULL,
          material_id uuid NOT NULL,
          material_version integer NOT NULL CHECK (material_version > 0),
          status varchar(16) NOT NULL
            CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
          correlation_id varchar(128) NOT NULL,
          error_code varchar(128),
          error_message varchar(1000),
          error_retryable boolean,
          callback_delivered_at timestamptz,
          started_at timestamptz NOT NULL DEFAULT now(),
          ended_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK ((status = 'FAILED') = (error_code IS NOT NULL)),
          CHECK (
            error_code IS NULL OR (error_message IS NOT NULL AND error_retryable IS NOT NULL)
          ),
          CHECK ((status = 'RUNNING') = (ended_at IS NULL))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE ai.model_run (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          task_type varchar(32) NOT NULL CHECK (task_type IN ('EMBED', 'ANSWER')),
          provider varchar(100) NOT NULL,
          model_name varchar(200) NOT NULL,
          model_revision varchar(200) NOT NULL,
          dimensions integer,
          prompt_version varchar(100),
          parameters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          status varchar(16) NOT NULL
            CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
          correlation_id varchar(128) NOT NULL,
          started_at timestamptz NOT NULL DEFAULT now(),
          ended_at timestamptz,
          error_code varchar(128),
          created_at timestamptz NOT NULL DEFAULT now(),
          CHECK (dimensions IS NULL OR dimensions > 0),
          CHECK ((status = 'RUNNING') = (ended_at IS NULL))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE ai.material_version (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id varchar(128) NOT NULL,
          curriculum_id uuid NOT NULL,
          lesson_id uuid NOT NULL,
          material_id uuid NOT NULL,
          material_version integer NOT NULL CHECK (material_version > 0),
          state varchar(16) NOT NULL
            CHECK (state IN ('BUILDING', 'ACTIVE', 'RETIRED', 'FAILED')),
          source_bucket varchar(255) NOT NULL,
          source_object_key varchar(1024) NOT NULL,
          chunk_strategy varchar(100) NOT NULL,
          input_fingerprint varchar(64) NOT NULL
            CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
          job_run_id bigint NOT NULL REFERENCES ai.job_run(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          activated_at timestamptz,
          retired_at timestamptz,
          UNIQUE (tenant_id, material_id, material_version)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_material_one_active
        ON ai.material_version (tenant_id, material_id)
        WHERE state = 'ACTIVE'
        """
    )
    op.execute(
        """
        CREATE TABLE ai.document_chunk (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          material_version_id bigint NOT NULL
            REFERENCES ai.material_version(id) ON DELETE CASCADE,
          chunk_index integer NOT NULL CHECK (chunk_index >= 0),
          page integer NOT NULL CHECK (page > 0),
          text text NOT NULL CHECK (length(text) > 0),
          content_hash varchar(128) NOT NULL,
          search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
          metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (material_version_id, chunk_index)
        )
        """
    )
    op.execute("CREATE INDEX ix_document_chunk_fts ON ai.document_chunk USING gin (search_vector)")
    op.execute(
        """
        CREATE TABLE ai.chunk_embedding (
          chunk_id bigint PRIMARY KEY REFERENCES ai.document_chunk(id) ON DELETE CASCADE,
          model_run_id bigint NOT NULL REFERENCES ai.model_run(id),
          model_name varchar(200) NOT NULL,
          model_revision varchar(200) NOT NULL,
          dimensions integer NOT NULL DEFAULT 1024 CHECK (dimensions = 1024),
          embedding vector(1024) NOT NULL,
          normalized boolean NOT NULL DEFAULT true CHECK (normalized),
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_chunk_embedding_hnsw "
        "ON ai.chunk_embedding USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX ix_material_scope "
        "ON ai.material_version (tenant_id, curriculum_id, lesson_id, state)"
    )
    op.execute(
        "CREATE INDEX ix_job_run_material_order "
        "ON ai.job_run (tenant_id, material_id, task_type, status, material_version DESC)"
    )
    op.execute(
        f"""
        GRANT SELECT, INSERT, UPDATE, DELETE
        ON ai.job_run, ai.model_run, ai.material_version, ai.document_chunk, ai.chunk_embedding
        TO {runtime_role}
        """
    )
    op.execute(
        f"""
        GRANT USAGE, SELECT
        ON SEQUENCE ai.job_run_id_seq, ai.model_run_id_seq,
                    ai.material_version_id_seq, ai.document_chunk_id_seq
        TO {runtime_role}
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai.chunk_embedding")
    op.execute("DROP TABLE IF EXISTS ai.document_chunk")
    op.execute("DROP TABLE IF EXISTS ai.material_version")
    op.execute("DROP TABLE IF EXISTS ai.model_run")
    op.execute("DROP TABLE IF EXISTS ai.job_run")
