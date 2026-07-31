from __future__ import annotations

from dataclasses import dataclass

from app.application.map_material_job import map_embed_delete_job
from app.contracts import EmbedDeleteJob
from app.ports import IndexStorage


@dataclass(frozen=True, slots=True)
class MaterialDeleteResult:
    deleted: bool


class DeleteMaterialIndex:
    """Resolve a delete-only job's scope from storage, then remove its indexed data (ADR-0006)."""

    def __init__(
        self,
        index_storage: IndexStorage,
        *,
        tenant_id: str,
        model_revision: str,
        chunk_max_chars: int,
    ) -> None:
        self._index_storage = index_storage
        self._tenant_id = tenant_id
        self._model_revision = model_revision
        self._chunk_max_chars = chunk_max_chars

    async def has_pending_data(self, job: EmbedDeleteJob) -> bool:
        """True if the material still has indexed data (delete not yet completed)."""

        scope = await self._index_storage.resolve_active_scope(self._tenant_id, job.material_id)
        return scope is not None

    async def execute(self, job: EmbedDeleteJob) -> MaterialDeleteResult:
        scope = await self._index_storage.resolve_active_scope(self._tenant_id, job.material_id)
        if scope is None:
            return MaterialDeleteResult(deleted=False)

        material = map_embed_delete_job(
            job,
            tenant_id=self._tenant_id,
            scope=scope,
            model_revision=self._model_revision,
            chunk_max_chars=self._chunk_max_chars,
        )
        removed_rows = await self._index_storage.delete_job(material)
        return MaterialDeleteResult(deleted=removed_rows > 0)
