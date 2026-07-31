from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from app.domain import ChunkRecord, ExistingIndexVersion, MaterialScope, StagedMaterial
from app.ingestion.models import KeyTerm


class MaterialAssetStore(Protocol):
    async def read_pptx(self, bucket: str, object_key: str) -> bytes: ...


class TextEmbeddingModel(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def model_revision(self) -> str: ...

    @property
    def dimensions(self) -> int: ...

    async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]: ...


class KeyTermExtractor(Protocol):
    async def extract(self, text: str) -> Sequence[KeyTerm]: ...


class IndexStorage(Protocol):
    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None: ...

    async def stage(self, material: StagedMaterial, chunks: Sequence[ChunkRecord]) -> int: ...

    async def activate(self, material: StagedMaterial, version_id: int) -> None: ...

    async def resolve_active_scope(
        self, tenant_id: str, material_id: UUID
    ) -> MaterialScope | None: ...

    async def delete_job(self, material: StagedMaterial) -> int: ...


class KeyTermStorage(Protocol):
    async def store(self, version_id: int, key_terms: Sequence[KeyTerm]) -> None: ...
