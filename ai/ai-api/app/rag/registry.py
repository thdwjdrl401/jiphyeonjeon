from __future__ import annotations

import asyncio
from collections import OrderedDict
from typing import Protocol


class DuplicateRequestError(Exception):
    """Raised before SSE headers when requestId has already been reserved."""


class RequestRegistryFullError(Exception):
    """Raised before SSE headers when the bounded active-request limit is full."""


class RequestLease(Protocol):
    async def complete(self) -> None: ...


class RequestRegistry(Protocol):
    async def acquire(self, request_id: str) -> RequestLease: ...


class InMemoryRequestRegistry:
    """One-process active/recent requestId guard with explicit memory bounds."""

    def __init__(self, *, max_active: int = 256, max_completed: int = 10_000) -> None:
        if max_active <= 0 or max_completed <= 0:
            raise ValueError("request registry bounds must be positive")
        self._max_active = max_active
        self._max_completed = max_completed
        self._active: set[str] = set()
        self._completed: OrderedDict[str, None] = OrderedDict()
        self._lock = asyncio.Lock()

    async def acquire(self, request_id: str) -> RequestLease:
        async with self._lock:
            if request_id in self._active or request_id in self._completed:
                raise DuplicateRequestError("requestId was already used")
            if len(self._active) >= self._max_active:
                raise RequestRegistryFullError("too many active RAG requests")
            self._active.add(request_id)
        return _InMemoryRequestLease(self, request_id)

    async def _complete(self, request_id: str) -> None:
        async with self._lock:
            if request_id not in self._active:
                return
            self._active.remove(request_id)
            self._completed[request_id] = None
            while len(self._completed) > self._max_completed:
                self._completed.popitem(last=False)

    async def snapshot(self) -> dict[str, int]:
        async with self._lock:
            return {
                "active": len(self._active),
                "completed": len(self._completed),
            }


class _InMemoryRequestLease:
    def __init__(self, registry: InMemoryRequestRegistry, request_id: str) -> None:
        self._registry = registry
        self._request_id = request_id
        self._completed = False
        self._lock = asyncio.Lock()

    async def complete(self) -> None:
        async with self._lock:
            if self._completed:
                return
            await self._registry._complete(self._request_id)
            self._completed = True
