from __future__ import annotations

import asyncio
import math
import re
import threading
from collections.abc import Callable, Iterable, Sequence

BGE_M3_MODEL = "BAAI/bge-m3"
BGE_M3_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
EMBEDDING_DIMENSIONS = 1024

CPU_DEVICE = "cpu"

_CUDA_DEVICE_PATTERN = re.compile(r"cuda(?::(0|[1-9][0-9]*))?\Z")
_IMMUTABLE_REVISION_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


def parse_cuda_device(device: str) -> int:
    """Return the CUDA index for a canonical ``cuda`` or ``cuda:N`` device."""

    match = _CUDA_DEVICE_PATTERN.fullmatch(device)
    if match is None:
        raise ValueError("device must be 'cuda' or a canonical non-negative 'cuda:N'")
    index = match.group(1)
    return 0 if index is None else int(index)


def parse_device(device: str) -> str:
    """Return the canonical device string for ``cpu``, ``cuda``, or ``cuda:N``."""

    if device == CPU_DEVICE:
        return device
    if _CUDA_DEVICE_PATTERN.fullmatch(device) is None:
        raise ValueError("device must be 'cpu', 'cuda', or a canonical non-negative 'cuda:N'")
    return device


def _install_extra_for(device: str) -> str:
    return CPU_DEVICE if device == CPU_DEVICE else "cuda"


def _missing_extra_error(missing: str | None, device: str) -> RuntimeError:
    dependency = f" ({missing})" if missing else ""
    extra = _install_extra_for(device)
    return RuntimeError(
        f"BGE-M3 {extra} dependencies are not installed"
        f"{dependency}; run `uv sync --frozen --extra {extra}` in ai/bge-runtime"
    )


def ensure_device_available(device: str) -> None:
    parse_device(device)
    try:
        import torch
    except ImportError as exc:
        raise _missing_extra_error(getattr(exc, "name", None), device) from exc

    if device == CPU_DEVICE:
        return

    index = parse_cuda_device(device)
    if not torch.cuda.is_available() or index >= torch.cuda.device_count():
        raise RuntimeError(f"requested embedding device {device!r} is unavailable")


class BgeM3EmbeddingModel:
    def __init__(
        self,
        model: str,
        revision: str,
        *,
        device: str,
        batch_size: int,
        loader: Callable[..., object] | None = None,
        device_validator: Callable[[str], None] = ensure_device_available,
    ) -> None:
        parse_device(device)
        if _IMMUTABLE_REVISION_PATTERN.fullmatch(revision) is None:
            raise ValueError("revision must be a full 40-character lowercase Git commit SHA")
        if not model.strip() or model != model.strip():
            raise ValueError("model must not be blank or have surrounding whitespace")
        if batch_size < 1:
            raise ValueError("batch_size must be positive")
        device_validator(device)

        self.model = model
        self.revision = revision
        self.device = device
        self.batch_size = batch_size
        self._loader = loader
        self._loaded: object | None = None
        # This lock deliberately lives in the worker thread. Cancelling the awaiting
        # coroutine cannot release it while CUDA inference is still running.
        self._inference_lock = threading.Lock()

    async def warmup(self) -> None:
        await self.embed(["LiveClass BGE-M3 readiness probe"])

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        copied_texts = list(texts)
        self._validate_texts(copied_texts)
        worker = asyncio.create_task(asyncio.to_thread(self._embed_sync, copied_texts))
        cancellation: asyncio.CancelledError | None = None

        # asyncio cannot stop a running OS thread. Keep this coroutine alive until the
        # worker finishes so HTTP admission is not released while GPU work is still
        # active or queued. shield also prevents cancellation of the wrapper future.
        while not worker.done():
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError as exc:
                cancellation = exc
            except Exception:
                if cancellation is None:
                    raise
                break

        if cancellation is not None:
            if not worker.cancelled():
                worker.exception()
            raise cancellation
        return worker.result()

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        self._validate_texts(texts)
        with self._inference_lock:
            loaded = self._load_model()
            encoded = loaded.encode(  # type: ignore[attr-defined]
                texts,
                batch_size=self.batch_size,
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            return self._validate_vectors(encoded, expected_count=len(texts))

    def _load_model(self) -> object:
        if self._loaded is not None:
            return self._loaded

        loader = self._loader
        if loader is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise _missing_extra_error(getattr(exc, "name", None), self.device) from exc
            loader = SentenceTransformer

        try:
            loaded = loader(
                self.model,
                revision=self.revision,
                device=self.device,
                trust_remote_code=False,
            )
        except ImportError as exc:
            raise _missing_extra_error(getattr(exc, "name", None), self.device) from exc

        self._loaded = loaded
        return loaded

    @staticmethod
    def _validate_texts(texts: list[str]) -> None:
        if not texts:
            raise ValueError("texts must contain at least one item")
        if any(not isinstance(text, str) or not text.strip() for text in texts):
            raise ValueError("texts must not contain blank items")

    @staticmethod
    def _validate_vectors(
        encoded: Iterable[Iterable[object]], *, expected_count: int
    ) -> list[list[float]]:
        try:
            # Iteration preserves the encoder's row order; no regrouping or sorting is done.
            vectors = [[float(value) for value in row] for row in encoded]
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("BGE-M3 returned a non-numeric embedding") from exc

        if len(vectors) != expected_count:
            raise ValueError(
                f"BGE-M3 returned {len(vectors)} vectors for {expected_count} input texts"
            )
        if any(len(vector) != EMBEDDING_DIMENSIONS for vector in vectors):
            raise ValueError(f"BGE-M3 embeddings must have {EMBEDDING_DIMENSIONS} dimensions")

        for vector in vectors:
            if not all(math.isfinite(value) for value in vector):
                raise ValueError("BGE-M3 returned a non-finite embedding")
            squared_norm = math.fsum(value * value for value in vector)
            if not math.isclose(squared_norm, 1.0, rel_tol=1e-4, abs_tol=1e-6):
                raise ValueError("BGE-M3 returned a non-normalized embedding")
        return vectors
