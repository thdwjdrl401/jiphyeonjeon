from __future__ import annotations

import asyncio

import pytest

from app.jobs.shutdown_deadline import ShutdownDeadline


def test_starts_once_and_tracks_remaining_absolute_budget() -> None:
    now = [100.0]
    deadline = ShutdownDeadline(12, clock=lambda: now[0])

    assert deadline.deadline is None
    assert deadline.start(100.0) == 112.0
    assert deadline.start(100.0) == 112.0
    now[0] = 104.5
    assert deadline.remaining() == 7.5

    with pytest.raises(RuntimeError, match="another time"):
        deadline.start(101.0)


async def test_stage_timeout_uses_smaller_absolute_remaining_budget() -> None:
    loop = asyncio.get_running_loop()
    deadline = ShutdownDeadline(0.01)
    deadline.start(loop.time())

    with pytest.raises(TimeoutError):
        async with deadline.timeout(10):
            await asyncio.sleep(1)


def test_expired_or_unstarted_deadline_fails_closed() -> None:
    now = [20.0]
    deadline = ShutdownDeadline(1, clock=lambda: now[0])

    with pytest.raises(RuntimeError, match="has not started"):
        deadline.remaining()

    deadline.start(18.0)
    assert deadline.remaining() == 0


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, ValueError),
        (-1, ValueError),
        (float("nan"), TypeError),
        (float("inf"), TypeError),
        (True, TypeError),
        ("12", TypeError),
    ],
)
def test_rejects_invalid_total_budget(value: object, expected: type[Exception]) -> None:
    with pytest.raises(expected):
        ShutdownDeadline(value)  # type: ignore[arg-type]
