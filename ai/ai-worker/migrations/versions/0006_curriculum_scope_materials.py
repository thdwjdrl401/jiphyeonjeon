"""Allow curriculum-scoped materials, which have no lesson.

Materials attach at two levels (docs/ai/CONTRACT.md §9): curriculum-wide ones are always in
scope for RAG, lesson ones add to their lesson's context. Spring already publishes both —
`scope:"CURRICULUM"` jobs carry no `lessonId` — so requiring lesson_id here made every one of
them fail and pile up in the DLQ.

Only the NOT NULL constraints move. Both indexes keep working: `uq_material_one_active` is keyed
on (tenant_id, material_id), and `ix_material_scope` is a btree, which indexes NULLs.
"""

from alembic import op


revision = "0006_curriculum_scope_materials"
down_revision = "0004_annotation_text_unbounded"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE ai.material_version ALTER COLUMN lesson_id DROP NOT NULL")
    op.execute("ALTER TABLE ai.job_run ALTER COLUMN lesson_id DROP NOT NULL")


def downgrade() -> None:
    # Curriculum-scoped rows cannot satisfy NOT NULL, so restoring it means discarding them.
    # That is destructive and only acceptable because downgrade is a recovery path — a
    # curriculum material would have to be re-indexed from Spring afterwards.
    op.execute("DELETE FROM ai.material_version WHERE lesson_id IS NULL")
    op.execute("DELETE FROM ai.job_run WHERE lesson_id IS NULL")
    op.execute("ALTER TABLE ai.job_run ALTER COLUMN lesson_id SET NOT NULL")
    op.execute("ALTER TABLE ai.material_version ALTER COLUMN lesson_id SET NOT NULL")
