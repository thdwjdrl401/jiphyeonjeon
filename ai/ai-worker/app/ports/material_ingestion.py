from collections.abc import Sequence
from typing import Protocol

from app.domain import ChunkRecord, ExistingIndexVersion, StagedMaterial


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


class IndexStorage(Protocol):
    async def find_existing(self, material: StagedMaterial) -> ExistingIndexVersion | None: ...

    async def stage(self, material: StagedMaterial, chunks: Sequence[ChunkRecord]) -> int: ...

    async def activate(self, material: StagedMaterial, version_id: int) -> None: ...
