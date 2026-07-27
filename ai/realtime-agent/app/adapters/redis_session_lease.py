from __future__ import annotations

import asyncio
import math
import re
from typing import Protocol
from uuid import UUID

_SAFE_OWNER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_RENEW_IF_OWNER = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
""".strip()
_DELETE_IF_OWNER = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
""".strip()


class RedisLeaseClient(Protocol):
    async def set(
        self,
        name: str,
        value: str,
        *,
        nx: bool,
        ex: int,
    ) -> object: ...

    async def eval(self, script: str, numkeys: int, *keys_and_args: object) -> object: ...


class SessionLeaseLostError(RuntimeError):
    """The session lease expired, was replaced, or could not be renewed."""


class RedisSessionLease:
    def __init__(
        self,
        client: RedisLeaseClient,
        session_id: UUID,
        owner_id: str,
        *,
        ttl_seconds: int = 30,
        operation_timeout_seconds: float = 1.0,
    ) -> None:
        if not isinstance(session_id, UUID):
            raise TypeError("session_id must be a UUID")
        if not isinstance(owner_id, str) or not _SAFE_OWNER_ID.fullmatch(owner_id):
            raise ValueError("owner_id must be a 1-128 character safe identifier")
        if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int):
            raise TypeError("ttl_seconds must be an integer")
        if ttl_seconds < 3:
            raise ValueError("lease ttl must be at least 3 seconds")
        if (
            isinstance(operation_timeout_seconds, bool)
            or not isinstance(operation_timeout_seconds, int | float)
            or not math.isfinite(operation_timeout_seconds)
        ):
            raise TypeError("operation_timeout_seconds must be a finite number")
        if operation_timeout_seconds <= 0:
            raise ValueError("operation_timeout_seconds must be positive")
        self._client = client
        self._key = f"agent:session:{session_id}"
        self._owner_id = owner_id
        self._ttl_seconds = ttl_seconds
        self._renew_interval = ttl_seconds / 3
        # A stuck renewal must be detected before the existing key can expire and admit another
        # owner. The caller's timeout is therefore a ceiling, not permission to exceed one interval.
        self._operation_timeout_seconds = min(
            float(operation_timeout_seconds),
            self._renew_interval,
        )
        self._renew_task: asyncio.Task[None] | None = None
        self._lost = asyncio.Event()
        self._failure: BaseException | None = None
        self._acquired = False

    @property
    def key(self) -> str:
        return self._key

    async def acquire(self) -> bool:
        if self._acquired or self._renew_task is not None:
            raise RuntimeError("session lease acquire may only be attempted once")
        async with asyncio.timeout(self._operation_timeout_seconds):
            acquired = await self._client.set(
                self._key,
                self._owner_id,
                nx=True,
                ex=self._ttl_seconds,
            )
        if not acquired:
            return False
        self._acquired = True
        self._renew_task = asyncio.create_task(self._renew_until_released())
        return True

    async def wait_lost(self) -> None:
        if not self._acquired:
            raise RuntimeError("session lease is not acquired")
        await self._lost.wait()
        if self._failure is not None:
            raise SessionLeaseLostError(
                f"session lease renewal failed: {self._key}"
            ) from self._failure
        raise SessionLeaseLostError(f"session lease ownership changed: {self._key}")

    async def release(self) -> None:
        if not self._acquired:
            return
        task = self._renew_task
        self._renew_task = None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        try:
            async with asyncio.timeout(self._operation_timeout_seconds):
                await self._client.eval(
                    _DELETE_IF_OWNER,
                    1,
                    self._key,
                    self._owner_id,
                )
        finally:
            self._acquired = False

    async def _renew_until_released(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._renew_interval)
                async with asyncio.timeout(self._operation_timeout_seconds):
                    renewed = await self._client.eval(
                        _RENEW_IF_OWNER,
                        1,
                        self._key,
                        self._owner_id,
                        self._ttl_seconds,
                    )
                if not renewed:
                    self._lost.set()
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - any Redis renewal error loses the lease
            self._failure = exc
            self._lost.set()
