from __future__ import annotations

import asyncio

import pytest

from app.contracts.live_status import LiveAgentError
from app.jobs.lifecycle import (
    DisabledLifecycleReporter,
    LifecycleFailure,
    classify_failure,
    report_nonterminal_best_effort,
)


class KnownFailure(LifecycleFailure):
    error_code = "KNOWN_FAILURE"
    public_message = "known public message"
    retryable = True


class FailingReporter:
    async def report(self, state, error=None) -> None:
        del state, error
        raise ConnectionError("callback unavailable")

    async def close(self) -> None:
        return


class CancellingReporter:
    async def report(self, state, error=None) -> None:
        del state, error
        raise asyncio.CancelledError

    async def close(self) -> None:
        return


class BlockingReporter:
    def __init__(self) -> None:
        self.cancelled = asyncio.Event()

    async def report(self, state, error=None) -> None:
        del state, error
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise

    async def close(self) -> None:
        return


def test_classifies_known_failure_without_leaking_internal_detail() -> None:
    assert classify_failure(KnownFailure("secret detail")) == LiveAgentError(
        code="KNOWN_FAILURE",
        message="known public message",
        retryable=True,
    )
    assert classify_failure(RuntimeError("secret detail")) == LiveAgentError(
        code="AGENT_INTERNAL_ERROR",
        message="realtime-agent execution failed",
        retryable=False,
    )


async def test_disabled_reporter_still_validates_state_error_pair() -> None:
    reporter = DisabledLifecycleReporter()

    await reporter.report("ROOM_CONNECTED")
    with pytest.raises(ValueError, match="requires error"):
        await reporter.report("FAILED")


async def test_nonterminal_callback_failure_is_best_effort() -> None:
    await report_nonterminal_best_effort(FailingReporter(), "STT_STARTED")


async def test_callback_cancellation_is_not_swallowed() -> None:
    with pytest.raises(asyncio.CancelledError):
        await report_nonterminal_best_effort(CancellingReporter(), "AUDIO_STARTED")


async def test_nonterminal_callback_has_a_small_failure_budget() -> None:
    reporter = BlockingReporter()

    await report_nonterminal_best_effort(
        reporter,
        "ROOM_CONNECTED",
        timeout_seconds=0.01,
    )

    assert reporter.cancelled.is_set()


async def test_terminal_state_cannot_use_best_effort_helper() -> None:
    with pytest.raises(ValueError, match="terminal"):
        await report_nonterminal_best_effort(FailingReporter(), "SUCCEEDED")
