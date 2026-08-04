"""Store instructor highlight descriptions as timeline-anchored RAG evidence (ADR-0074)."""

import os
import re

from alembic import op


revision = "0003_annotation_highlight"
down_revision = "0002_material_key_terms"
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
    # One highlight is one indexed unit: no chunk table, so text/embedding live inline.
    # search_vector is generated like ai.document_chunk so it can never drift from text.
    # No asset_id column: Spring reads the crop and keeps the image, sending only the text
    # (ADR-0074 결정 1), so this side never addresses the original.
    op.execute(
        """
        CREATE TABLE ai.annotation_highlight (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          highlight_id uuid NOT NULL UNIQUE,
          curriculum_id uuid NOT NULL,
          lesson_id uuid NOT NULL,
          session_id uuid NOT NULL,
          session_ms bigint NOT NULL CHECK (session_ms >= 0),
          captured_at timestamptz NOT NULL,
          text varchar(2000) NOT NULL CHECK (length(btrim(text)) > 0),
          search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
          embedding vector(1024) NOT NULL,
          state varchar(16) NOT NULL CHECK (state IN ('ACTIVE', 'DELETED')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # Curriculum-wide semantic search scope (ADR-0007), same axis as material search.
    op.execute(
        "CREATE INDEX ix_annotation_highlight_scope "
        "ON ai.annotation_highlight (curriculum_id, state)"
    )
    # Recent-annotation window and the replay session_ms <= questionSessionMs filter
    # (ADR-0043 §4, §5).
    op.execute(
        "CREATE INDEX ix_annotation_highlight_timeline "
        "ON ai.annotation_highlight (session_id, state, session_ms DESC)"
    )
    op.execute(
        "CREATE INDEX ix_annotation_highlight_fts "
        "ON ai.annotation_highlight USING gin (search_vector)"
    )
    op.execute(
        "CREATE INDEX ix_annotation_highlight_hnsw "
        "ON ai.annotation_highlight USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute(
        f"""
        GRANT SELECT, INSERT, UPDATE, DELETE
        ON ai.annotation_highlight
        TO {runtime_role}
        """
    )
    op.execute(
        f"""
        GRANT USAGE, SELECT
        ON SEQUENCE ai.annotation_highlight_id_seq
        TO {runtime_role}
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai.annotation_highlight")
