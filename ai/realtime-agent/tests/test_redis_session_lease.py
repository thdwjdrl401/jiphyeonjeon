import asyncio
from uuid import UUID

import pytest

from app.adapters.redis_session_lease import RedisSessionLease, SessionLeaseLostError

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")


class FakeRedis:
    def __init__(
        self,
        *,
        acquired: bool = True,
        renewed: int = 1,
        renew_failure: BaseException | None = None,
        block_set: bool = False,
        block_renew: bool = False,
        block_delete: bool = False,
    ) -> None:
        self.acquired = acquired
        self.renewed = renewed
        self.renew_failure = renew_failure
        self.block_set = block_set
        self.block_renew = block_renew
        self.block_delete = block_delete
        self.set_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
        self.eval_calls: list[tuple[object, ...]] = []
        self.cancelled_operations: list[str] = []

    async def set(self, *args: object, **kwargs: object) -> bool:
        self.set_calls.append((args, kwargs))
        if self.block_set:
            await self._block_until_cancelled("set")
        return self.acquired

    async def eval(self, *args: object) -> int:
        self.eval_calls.append(args)
        if "EXPIRE" in str(args[0]):
            if self.renew_failure is not None:
                raise self.renew_failure
            if self.block_renew:
                await self._block_until_cancelled("renew")
            return self.renewed
        if self.block_delete:
            await self._block_until_cancelled("delete")
        return 1

    async def _block_until_cancelled(self, operation: str) -> None:
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            self.cancelled_operations.append(operation)
            raise


async def test_acquires_set_nx_ex_and_owner_only_release() -> None:
    redis = FakeRedis()
    lease = RedisSessionLease(redis, SESSION_ID, "job-1")

    assert await lease.acquire() is True
    await lease.release()

    assert redis.set_calls == [
        (
            ("agent:session:11111111-1111-4111-8111-111111111111", "job-1"),
            {"nx": True, "ex": 30},
        )
    ]
    delete_call = redis.eval_calls[-1]
    assert "GET" in str(delete_call[0]) and "DEL" in str(delete_call[0])
    assert delete_call[1:] == (
        1,
        "agent:session:11111111-1111-4111-8111-111111111111",
        "job-1",
    )


async def test_does_not_delete_when_acquisition_fails() -> None:
    redis = FakeRedis(acquired=False)
    lease = RedisSessionLease(redis, SESSION_ID, "job-2")

    assert await lease.acquire() is False
    await lease.release()

    assert redis.eval_calls == []


async def test_renewal_uses_owner_guard_and_reports_ownership_loss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = FakeRedis(renewed=0)
    lease = RedisSessionLease(redis, SESSION_ID, "job-1", ttl_seconds=3)
    real_sleep = asyncio.sleep

    async def no_delay(_seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr("app.adapters.redis_session_lease.asyncio.sleep", no_delay)
    assert await lease.acquire() is True

    with pytest.raises(SessionLeaseLostError, match="ownership changed"):
        await lease.wait_lost()

    renew_call = next(call for call in redis.eval_calls if "EXPIRE" in str(call[0]))
    assert renew_call[1:] == (
        1,
        "agent:session:11111111-1111-4111-8111-111111111111",
        "job-1",
        3,
    )
    await lease.release()


async def test_renewal_transport_failure_is_reported_with_cause(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = ConnectionError("redis unavailable")
    redis = FakeRedis(renew_failure=failure)
    lease = RedisSessionLease(redis, SESSION_ID, "job-1", ttl_seconds=3)
    real_sleep = asyncio.sleep

    async def no_delay(_seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr("app.adapters.redis_session_lease.asyncio.sleep", no_delay)
    assert await lease.acquire() is True

    with pytest.raises(SessionLeaseLostError, match="renewal failed") as caught:
        await lease.wait_lost()

    assert caught.value.__cause__ is failure
    await lease.release()


async def test_acquire_timeout_is_bounded_and_propagated() -> None:
    redis = FakeRedis(block_set=True)
    lease = RedisSessionLease(
        redis,
        SESSION_ID,
        "job-1",
        operation_timeout_seconds=0.01,
    )

    with pytest.raises(TimeoutError):
        await lease.acquire()

    assert redis.cancelled_operations == ["set"]
    await lease.release()
    assert redis.eval_calls == []


async def test_renew_timeout_is_reported_as_lease_loss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = FakeRedis(block_renew=True)
    lease = RedisSessionLease(
        redis,
        SESSION_ID,
        "job-1",
        ttl_seconds=3,
        operation_timeout_seconds=0.01,
    )
    real_sleep = asyncio.sleep

    async def no_delay(_seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr("app.adapters.redis_session_lease.asyncio.sleep", no_delay)
    assert await lease.acquire() is True

    with pytest.raises(SessionLeaseLostError, match="renewal failed") as caught:
        await lease.wait_lost()

    assert isinstance(caught.value.__cause__, TimeoutError)
    assert redis.cancelled_operations == ["renew"]
    await lease.release()


async def test_release_timeout_propagates_and_clears_internal_ownership() -> None:
    redis = FakeRedis(block_delete=True)
    lease = RedisSessionLease(
        redis,
        SESSION_ID,
        "job-1",
        operation_timeout_seconds=0.01,
    )
    assert await lease.acquire() is True

    with pytest.raises(TimeoutError):
        await lease.release()

    assert redis.cancelled_operations == ["delete"]
    delete_call_count = len(redis.eval_calls)
    await lease.release()
    assert len(redis.eval_calls) == delete_call_count
    with pytest.raises(RuntimeError, match="not acquired"):
        await lease.wait_lost()


@pytest.mark.parametrize("timeout", [0, -1])
def test_rejects_nonpositive_operation_timeout(timeout: float) -> None:
    with pytest.raises(ValueError, match="must be positive"):
        RedisSessionLease(
            FakeRedis(),
            SESSION_ID,
            "job-1",
            operation_timeout_seconds=timeout,
        )


@pytest.mark.parametrize("timeout", [True, float("nan"), float("inf")])
def test_rejects_nonfinite_or_boolean_operation_timeout(timeout: float) -> None:
    with pytest.raises(TypeError, match="finite number"):
        RedisSessionLease(
            FakeRedis(),
            SESSION_ID,
            "job-1",
            operation_timeout_seconds=timeout,
        )
