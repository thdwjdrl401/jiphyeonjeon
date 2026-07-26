from __future__ import annotations

import pytest

from app.stt.registry import SttEngineRegistry, UnknownSttProviderError


def test_registry_normalizes_provider_name_and_creates_lazily() -> None:
    marker = object()
    created = 0

    def create() -> object:
        nonlocal created
        created += 1
        return marker

    registry = SttEngineRegistry()
    registry.register("stub", create)  # type: ignore[arg-type]

    assert created == 0
    assert registry.create(" STUB ") is marker
    assert created == 1


def test_registry_rejects_blank_and_duplicate_provider_names() -> None:
    registry = SttEngineRegistry()

    with pytest.raises(ValueError, match="provider must not be blank"):
        registry.register(" ", lambda: object())  # type: ignore[arg-type,return-value]

    registry.register("stub", lambda: object())  # type: ignore[arg-type,return-value]
    with pytest.raises(ValueError, match="provider already registered: stub"):
        registry.register(" STUB ", lambda: object())  # type: ignore[arg-type,return-value]


def test_unknown_provider_fails_fast_with_sorted_supported_names() -> None:
    registry = SttEngineRegistry()
    registry.register("stub", lambda: object())  # type: ignore[arg-type,return-value]
    registry.register("nemotron", lambda: object())  # type: ignore[arg-type,return-value]

    with pytest.raises(UnknownSttProviderError, match="supported: nemotron, stub"):
        registry.create("missing")
