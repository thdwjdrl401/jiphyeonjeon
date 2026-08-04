from __future__ import annotations

import logging
from uuid import UUID

from app.ports import AnnotationIndexStorage

logger = logging.getLogger(__name__)


class DeleteAnnotationSnapshot:
    """Withdraw one snapshot from the evidence index (ADR-0043 §2).

    Idempotent by construction: a snapshot that was never indexed, or was withdrawn already,
    is still the outcome the caller asked for. Spring re-sends deletes when a lesson or session
    is removed, and a stale highlight answering questions about a deleted lecture is the
    failure this guards against — not a duplicate request.
    """

    def __init__(self, index_storage: AnnotationIndexStorage) -> None:
        self._index_storage = index_storage

    async def execute(self, snapshot_id: UUID) -> None:
        await self._index_storage.mark_deleted(snapshot_id)
        logger.info(
            "withdrew annotation snapshot",
            extra={"event": "annotation.deleted", "snapshot_id": str(snapshot_id)},
        )
