from __future__ import annotations

from collections.abc import Callable

from app.stt.engine import StreamingSttEngine

EngineFactory = Callable[[], StreamingSttEngine]


class UnknownSttProviderError(ValueError):
    """Raised when no engine factory is registered for a provider name."""


class SttEngineRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, EngineFactory] = {}

    def register(self, provider: str, factory: EngineFactory) -> None:
        normalized = provider.strip().lower()
        if not normalized:
            raise ValueError("provider must not be blank")
        if normalized in self._factories:
            raise ValueError(f"provider already registered: {normalized}")
        self._factories[normalized] = factory

    def create(self, provider: str) -> StreamingSttEngine:
        normalized = provider.strip().lower()
        try:
            factory = self._factories[normalized]
        except KeyError as exc:
            supported = ", ".join(sorted(self._factories)) or "none"
            raise UnknownSttProviderError(
                f"unknown STT provider '{provider}'; supported: {supported}"
            ) from exc
        return factory()
