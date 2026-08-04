"""Persist the key-term branch result on each material version."""

from alembic import op


revision = "0005_material_key_term_result"
down_revision = "0004_annotation_text_unbounded"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai.material_version
          ADD COLUMN key_term_status varchar(20) NOT NULL DEFAULT 'NOT_REQUESTED'
            CHECK (key_term_status IN (
              'NOT_REQUESTED', 'PENDING', 'READY', 'EMPTY', 'FAILED'
            )),
          ADD COLUMN key_term_count integer NOT NULL DEFAULT 0
            CHECK (key_term_count >= 0),
          ADD COLUMN key_term_truncated boolean NOT NULL DEFAULT false,
          ADD COLUMN key_term_failure_code varchar(128),
          ADD CONSTRAINT ck_material_version_key_term_result CHECK (
            (key_term_status = 'READY' AND key_term_count > 0 AND key_term_failure_code IS NULL)
            OR (key_term_status IN ('NOT_REQUESTED', 'PENDING', 'EMPTY')
                AND key_term_count = 0 AND key_term_failure_code IS NULL)
            OR (key_term_status = 'FAILED'
                AND key_term_count = 0 AND key_term_failure_code IS NOT NULL)
          )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE ai.material_version
          DROP CONSTRAINT IF EXISTS ck_material_version_key_term_result,
          DROP COLUMN IF EXISTS key_term_failure_code,
          DROP COLUMN IF EXISTS key_term_truncated,
          DROP COLUMN IF EXISTS key_term_count,
          DROP COLUMN IF EXISTS key_term_status
        """
    )
