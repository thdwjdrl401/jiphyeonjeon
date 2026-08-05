from __future__ import annotations

from dataclasses import dataclass

from app.application.map_material_job import map_embed_delete_job
from app.contracts import EmbedDeleteJob
from app.domain import MaterialIngestionError, MaterialScope
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
        _assert_requested_scope_matches(job, scope)

        material = map_embed_delete_job(
            job,
            tenant_id=self._tenant_id,
            scope=scope,
            model_revision=self._model_revision,
            chunk_max_chars=self._chunk_max_chars,
        )
        removed_rows = await self._index_storage.delete_job(material)
        return MaterialDeleteResult(deleted=removed_rows > 0)


def _assert_requested_scope_matches(job: EmbedDeleteJob, scope: MaterialScope) -> None:
    """Refuse a delete whose envelope disagrees with what is actually stored.

    The scope in the envelope is not needed to find the rows — ADR-0006 resolves that from
    material_id — but when Spring does send it, a mismatch means the two sides disagree about
    which material this is. Deleting on that basis would remove evidence the caller never
    meant to touch, so the job fails loudly instead.
    """

    if job.lesson_id is not None and job.lesson_id != scope.lesson_id:
        raise MaterialIngestionError("delete job lessonId does not match the stored material")
    if job.curriculum_id is not None and job.curriculum_id != scope.curriculum_id:
        raise MaterialIngestionError("delete job curriculumId does not match the stored material")
    if job.scope == "CURRICULUM" and scope.lesson_id is not None:
        raise MaterialIngestionError("curriculum-scoped delete targets a lesson-scoped material")
