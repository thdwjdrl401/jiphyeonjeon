from __future__ import annotations

import asyncio
import builtins
import math
import threading
from collections.abc import Callable

import pytest

from app.embedding import (
    BGE_M3_REVISION,
    BgeM3EmbeddingModel,
    ensure_device_available,
    parse_cuda_device,
    parse_device,
)


def unit_vector(index: int = 0) -> list[float]:
    vector = [0.0] * 1024
    vector[index] = 1.0
    return vector


class Encoded:
    def __init__(self, vectors: list[list[float]]) -> None:
        self.vectors = vectors
        self.calls: list[tuple[list[str], dict[str, object]]] = []

    def encode(self, texts: list[str], **kwargs: object) -> list[list[float]]:
        self.calls.append((texts, kwargs))
        return self.vectors


def create_model(
    *,
    loader: Callable[..., object] | None,
    device: str = "cuda",
    revision: str = BGE_M3_REVISION,
) -> BgeM3EmbeddingModel:
    return BgeM3EmbeddingModel(
        "BAAI/bge-m3",
        revision,
        device=device,
        batch_size=2,
        loader=loader,
        device_validator=lambda _: None,
    )


@pytest.mark.parametrize(
    ("device", "index"),
    [("cuda", 0), ("cuda:0", 0), ("cuda:7", 7)],
)
def test_parse_cuda_device_accepts_only_canonical_values(device: str, index: int) -> None:
    assert parse_cuda_device(device) == index


@pytest.mark.parametrize("device", ["CPU", "cuda:", "cuda:-1", "cuda:01", "cuda:1:2"])
def test_model_rejects_invalid_device_before_custom_validator(device: str) -> None:
    with pytest.raises(ValueError, match="canonical non-negative"):
        create_model(loader=lambda *args, **kwargs: Encoded([]), device=device)


@pytest.mark.parametrize("device", ["cpu", "cuda", "cuda:7"])
def test_parse_device_accepts_cpu_and_canonical_cuda(device: str) -> None:
    assert parse_device(device) == device


def test_ensure_device_available_skips_cuda_probe_on_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    # The cpu extra installs a torch built without CUDA, so probing torch.cuda would fail
    # on exactly the hosts this device exists to serve.
    class CudalessTorch:
        class cuda:
            @staticmethod
            def is_available() -> bool:
                raise AssertionError("cpu device must not probe CUDA")

            @staticmethod
            def device_count() -> int:
                raise AssertionError("cpu device must not probe CUDA")

    original_import = builtins.__import__

    def import_cudaless_torch(
        name: str,
        globals: object = None,
        locals: object = None,
        fromlist: object = (),
        level: int = 0,
    ) -> object:
        if name == "torch":
            return CudalessTorch
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", import_cudaless_torch)

    ensure_device_available("cpu")


def test_model_requires_full_immutable_revision() -> None:
    with pytest.raises(ValueError, match="40-character lowercase Git commit SHA"):
        create_model(loader=lambda *args, **kwargs: Encoded([]), revision="5617a9f")


def test_default_loader_has_actionable_cuda_extra_error(monkeypatch: pytest.MonkeyPatch) -> None:
    original_import = builtins.__import__

    def import_without_sentence_transformers(
        name: str,
        globals: object = None,
        locals: object = None,
        fromlist: object = (),
        level: int = 0,
    ) -> object:
        if name == "sentence_transformers":
            raise ModuleNotFoundError("No module named 'sentence_transformers'", name=name)
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", import_without_sentence_transformers)
    model = create_model(loader=None)

    with pytest.raises(RuntimeError, match=r"uv sync --frozen --extra cuda"):
        model._embed_sync(["question"])


def test_incompatible_torch_import_has_actionable_cuda_extra_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_import = builtins.__import__

    def import_incompatible_torch(
        name: str,
        globals: object = None,
        locals: object = None,
        fromlist: object = (),
        level: int = 0,
    ) -> object:
        if name == "torch":
            raise ImportError("incompatible torch binary", name=name)
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", import_incompatible_torch)

    with pytest.raises(RuntimeError, match=r"uv sync --frozen --extra cuda"):
        ensure_device_available("cuda")


@pytest.mark.parametrize("texts", [[], [""], ["   "]])
def test_embedding_rejects_empty_or_blank_texts_before_loading(texts: list[str]) -> None:
    loader_called = False

    def loader(*args: object, **kwargs: object) -> Encoded:
        nonlocal loader_called
        loader_called = True
        return Encoded([])

    model = create_model(loader=loader)

    with pytest.raises(ValueError, match="texts"):
        model._embed_sync(texts)

    assert loader_called is False


def test_async_embedding_rejects_blank_text_before_scheduling_thread() -> None:
    model = create_model(loader=lambda *args, **kwargs: Encoded([]))

    async def scenario() -> None:
        with pytest.raises(ValueError, match="texts"):
            await model.embed(["\t"])

    asyncio.run(scenario())


def test_embedding_preserves_count_order_and_encoder_options() -> None:
    vectors = [unit_vector(2), unit_vector(0), unit_vector(1)]
    encoded = Encoded(vectors)
    loader_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def loader(*args: object, **kwargs: object) -> Encoded:
        loader_calls.append((args, kwargs))
        return encoded

    model = create_model(loader=loader)

    result = model._embed_sync(["third", "first", "second"])

    assert result == vectors
    assert loader_calls == [
        (
            ("BAAI/bge-m3",),
            {
                "revision": BGE_M3_REVISION,
                "device": "cuda",
                "trust_remote_code": False,
            },
        )
    ]
    assert encoded.calls == [
        (
            ["third", "first", "second"],
            {
                "batch_size": 2,
                "convert_to_numpy": True,
                "normalize_embeddings": True,
                "show_progress_bar": False,
            },
        )
    ]


@pytest.mark.parametrize(
    "vectors",
    [
        [],
        [[1.0]],
        [[math.nan, *([0.0] * 1023)]],
        [[math.inf, *([0.0] * 1023)]],
        [[0.0] * 1024],
        [[0.5, *([0.0] * 1023)]],
    ],
)
def test_embedding_rejects_invalid_count_shape_finite_or_norm(
    vectors: list[list[float]],
) -> None:
    model = create_model(loader=lambda *args, **kwargs: Encoded(vectors))

    with pytest.raises(ValueError):
        model._embed_sync(["question"])


def test_cancelled_await_finishes_gpu_thread_before_propagating_and_serializes() -> None:
    first_encode_started = threading.Event()
    release_first_encode = threading.Event()
    state_lock = threading.Lock()
    encode_calls = 0
    loader_calls = 0

    class BlockingEncoded:
        def encode(self, texts: list[str], **kwargs: object) -> list[list[float]]:
            nonlocal encode_calls
            with state_lock:
                encode_calls += 1
                call_number = encode_calls
            if call_number == 1:
                first_encode_started.set()
                if not release_first_encode.wait(timeout=2):
                    raise TimeoutError("test did not release first inference")
            return [unit_vector() for _ in texts]

    def loader(*args: object, **kwargs: object) -> BlockingEncoded:
        nonlocal loader_calls
        loader_calls += 1
        return BlockingEncoded()

    model = create_model(loader=loader)

    async def scenario() -> None:
        first = asyncio.create_task(model.embed(["first"]))
        await asyncio.wait_for(asyncio.to_thread(first_encode_started.wait), timeout=1)
        first.cancel()
        await asyncio.sleep(0.05)
        assert not first.done()

        second = asyncio.create_task(model.embed(["second"]))
        try:
            await asyncio.sleep(0.05)
            with state_lock:
                assert encode_calls == 1
            assert loader_calls == 1
        finally:
            release_first_encode.set()

        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(first, timeout=1)
        assert await asyncio.wait_for(second, timeout=1) == [unit_vector()]

    asyncio.run(scenario())
    assert encode_calls == 2
    assert loader_calls == 1
