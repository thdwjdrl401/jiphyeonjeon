from uuid import UUID

from app.application import DeleteMaterialIndex
from app.contracts import EmbedDeleteJob
from app.domain import MaterialScope, StagedMaterial

MATERIAL_ID = UUID("550e8400-e29b-41d4-a716-446655440000")
LESSON_ID = UUID("550e8400-e29b-41d4-a716-446655440002")
CURRICULUM_ID = UUID("550e8400-e29b-41d4-a716-446655440003")
REVISION = "5617a9f61b028005a4858fdac845db406aefb181"


class FakeIndexStorage:
    def __init__(
        self,
        *,
        scope: MaterialScope | None = None,
        deleted_rows: int = 1,
    ) -> None:
        self.scope = scope
        self.deleted_rows = deleted_rows
        self.scope_lookups: list[tuple[str, UUID]] = []
        self.deleted: list[StagedMaterial] = []

    async def resolve_active_scope(self, tenant_id: str, material_id: UUID) -> MaterialScope | None:
        self.scope_lookups.append((tenant_id, material_id))
        return self.scope

    async def delete_job(self, material: StagedMaterial) -> int:
        self.deleted.append(material)
        return self.deleted_rows


def job() -> EmbedDeleteJob:
    return EmbedDeleteJob(
        taskType="EMBED_DELETE",
        materialId=MATERIAL_ID,
        lessonId=LESSON_ID,
        contractVersion=1,
    )


def deleter(index_storage: FakeIndexStorage) -> DeleteMaterialIndex:
    return DeleteMaterialIndex(
        index_storage,
        tenant_id="liveclass",
        model_revision=REVISION,
        chunk_max_chars=1_200,
    )


async def test_resolves_scope_then_deletes_with_the_current_stored_version() -> None:
    scope = MaterialScope(curriculum_id=CURRICULUM_ID, lesson_id=LESSON_ID, material_version=3)
    index_storage = FakeIndexStorage(scope=scope, deleted_rows=1)

    result = await deleter(index_storage).execute(job())

    assert result.deleted is True
    assert index_storage.scope_lookups == [("liveclass", MATERIAL_ID)]
    assert len(index_storage.deleted) == 1
    material = index_storage.deleted[0]
    assert material.curriculum_id == CURRICULUM_ID
    assert material.lesson_id == LESSON_ID
    assert material.material_id == MATERIAL_ID
    assert material.material_version == 3


async def test_nothing_to_delete_never_calls_delete_job() -> None:
    index_storage = FakeIndexStorage(scope=None)

    result = await deleter(index_storage).execute(job())

    assert result.deleted is False
    assert index_storage.deleted == []


async def test_delete_job_reporting_zero_rows_is_still_a_result_not_an_error() -> None:
    scope = MaterialScope(curriculum_id=CURRICULUM_ID, lesson_id=LESSON_ID, material_version=1)
    index_storage = FakeIndexStorage(scope=scope, deleted_rows=0)

    result = await deleter(index_storage).execute(job())

    assert result.deleted is False


async def test_has_pending_data_reflects_whether_scope_resolves() -> None:
    with_data = deleter(FakeIndexStorage(scope=MaterialScope(CURRICULUM_ID, LESSON_ID, 1)))
    without_data = deleter(FakeIndexStorage(scope=None))

    assert await with_data.has_pending_data(job()) is True
    assert await without_data.has_pending_data(job()) is False
