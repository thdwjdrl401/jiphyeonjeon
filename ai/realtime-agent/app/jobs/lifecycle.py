from __future__ import annotations

import asyncio
import logging
from typing import Protocol

from app.contracts.live_status import LiveAgentError, LiveAgentState, parse_state

logger = logging.getLogger(__name__)


class LifecycleFailure(RuntimeError):
    error_code = "AGENT_INTERNAL_ERROR"
    public_message = "realtime-agent execution failed"
    retryable = False


class LifecycleReporter(Protocol):
    async def report(
        self,
        state: LiveAgentState,
        error: LiveAgentError | None = None,
    ) -> None: ...

    async def close(self) -> None: ...


class DisabledLifecycleReporter:
    async def report(
        self,
        state: LiveAgentState,
        error: LiveAgentError | None = None,
    ) -> None:
        validate_status(state, error)

    async def close(self) -> None:
        return


def classify_failure(error: BaseException) -> LiveAgentError:
    if isinstance(error, LifecycleFailure):
        return LiveAgentError(
            code=error.error_code,
            message=error.public_message,
            retryable=error.retryable,
        )
    return LiveAgentError(
        code="AGENT_INTERNAL_ERROR",
        message="realtime-agent execution failed",
        retryable=False,
    )


def validate_status(
    state: LiveAgentState,
    error: LiveAgentError | None,
) -> None:
    parse_state(state)
    if state == "FAILED" and error is None:
        raise ValueError("FAILED lifecycle state requires error")
    if state != "FAILED" and error is not None:
        raise ValueError("error is only allowed for FAILED lifecycle state")


async def report_nonterminal_best_effort(
    reporter: LifecycleReporter,
    state: LiveAgentState,
    *,
    timeout_seconds: float = 0.25,
) -> None:
    if state in {"SUCCEEDED", "FAILED"}:
        raise ValueError("terminal lifecycle state is not best-effort")
    if timeout_seconds <= 0:
        raise ValueError("non-terminal callback timeout must be positive")
    try:
        async with asyncio.timeout(timeout_seconds):
            await reporter.report(state)
    except asyncio.CancelledError:
        raise
    except TimeoutError:
        logger.warning("non-terminal lifecycle callback timed out: state=%s", state)
    except Exception:
        logger.warning("non-terminal lifecycle callback failed: state=%s", state, exc_info=True)
