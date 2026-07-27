import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.adapters.redis_caption_publisher import RedisCaptionPublisher, to_stream_fields
from app.captions.models import CaptionDelta


def caption() -> CaptionDelta:
    return CaptionDelta(
        event_id="event-1",
        session_id=UUID("11111111-1111-4111-8111-111111111111"),
        lesson_id=UUID("22222222-2222-4222-8222-222222222222"),
        stt_session_id="stt-1",
        sequence=1,
        stream_elapsed_ms=20,
        text="안녕",
        occurred_at=datetime(2026, 7, 27, tzinfo=UTC),
    )


class FakeRedis:
    def __init__(
        self,
        *,
        failure: BaseException | None = None,
        block: bool = False,
    ) -> None:
        self.failure = failure
        self.block = block
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.cancelled = False

    async def xadd(self, name: str, fields: dict[str, str]) -> str:
        self.calls.append((name, fields))
        if self.failure is not None:
            raise self.failure
        if self.block:
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.cancelled = True
                raise
        return "1-0"


async def test_directly_awaits_xadd_without_maxlen_arguments() -> None:
    redis = FakeRedis()
    publisher = RedisCaptionPublisher(redis, "captions:test")
    event = caption()

    await publisher.publish_delta(event)

    assert redis.calls == [("captions:test", to_stream_fields(event))]


async def test_propagates_xadd_failure() -> None:
    redis = FakeRedis(failure=ConnectionError("redis unavailable"))
    publisher = RedisCaptionPublisher(redis)

    with pytest.raises(ConnectionError, match="redis unavailable"):
        await publisher.publish_delta(caption())


async def test_bounds_xadd_and_propagates_timeout() -> None:
    redis = FakeRedis(block=True)
    publisher = RedisCaptionPublisher(redis, publish_timeout_seconds=0.01)

    with pytest.raises(TimeoutError):
        await publisher.publish_delta(caption())

    assert redis.cancelled is True


def test_rejects_nonpositive_publish_timeout() -> None:
    with pytest.raises(ValueError, match="must be positive"):
        RedisCaptionPublisher(FakeRedis(), publish_timeout_seconds=0)


@pytest.mark.parametrize("timeout", [True, float("nan"), float("inf")])
def test_rejects_nonfinite_or_boolean_publish_timeout(timeout: float) -> None:
    with pytest.raises(TypeError, match="finite number"):
        RedisCaptionPublisher(FakeRedis(), publish_timeout_seconds=timeout)
