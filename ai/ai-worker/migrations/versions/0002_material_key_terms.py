"""Store extracted key terms alongside the material version that produced them."""

import os
import re

from alembic import op


revision = "0002_material_key_terms"
down_revision = "0001_rag_index_storage"
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
    op.execute(
        """
        CREATE TABLE ai.material_key_term (
          material_version_id bigint NOT NULL
            REFERENCES ai.material_version(id) ON DELETE CASCADE,
          term text NOT NULL CHECK (length(btrim(term)) > 0),
          definition text NOT NULL CHECK (length(btrim(definition)) > 0),
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (material_version_id, term)
        )
        """
    )
    op.execute(
        f"""
        GRANT SELECT, INSERT, UPDATE, DELETE
        ON ai.material_key_term
        TO {runtime_role}
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai.material_key_term")
