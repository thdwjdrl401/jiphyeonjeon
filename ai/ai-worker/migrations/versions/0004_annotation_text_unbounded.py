"""Drop the length cap on annotation highlight text.

`varchar(2000)` was chosen to mirror a wire limit, but nothing upstream enforces it: Spring's
vision model output goes through `trim()` into a `text` column with no cap (V29). A longer
description therefore failed to parse and landed in the DLQ **without a callback**, leaving the
instructor staring at PROCESSING forever.

Storage is the wrong place to enforce this. The embedding model has its own character contract
and the job envelope is already bounded at 64 KiB, so the text column just needs to hold
whatever Spring confirmed.

Postgres refuses to alter a column another generated column reads, so `search_vector` is
dropped and rebuilt around the change. Its GIN index goes with it and comes back after.
"""

from alembic import op


revision = "0004_annotation_text_unbounded"
down_revision = "0003_annotation_highlight"
branch_labels = None
depends_on = None

_ADD_SEARCH_VECTOR = """
ALTER TABLE ai.annotation_highlight
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
"""
_ADD_FTS_INDEX = (
    "CREATE INDEX ix_annotation_highlight_fts ON ai.annotation_highlight USING gin (search_vector)"
)


def upgrade() -> None:
    # Dropping the column takes its GIN index with it; both are rebuilt below.
    op.execute("ALTER TABLE ai.annotation_highlight DROP COLUMN search_vector")
    op.execute("ALTER TABLE ai.annotation_highlight ALTER COLUMN text TYPE text")
    op.execute(_ADD_SEARCH_VECTOR)
    op.execute(_ADD_FTS_INDEX)


def downgrade() -> None:
    # Rows longer than the old cap would block the narrowing, so trim them first. This loses
    # the tail of any oversized description — acceptable only because downgrade is a recovery
    # path, never a routine one.
    op.execute(
        "UPDATE ai.annotation_highlight SET text = left(text, 2000) WHERE length(text) > 2000"
    )
    op.execute("ALTER TABLE ai.annotation_highlight DROP COLUMN search_vector")
    op.execute("ALTER TABLE ai.annotation_highlight ALTER COLUMN text TYPE varchar(2000)")
    op.execute(_ADD_SEARCH_VECTOR)
    op.execute(_ADD_FTS_INDEX)
