import asyncio

import httpx
import pytest
from openai import BadRequestError, RateLimitError

from app.adapters import BoundedLectureNoteModel
from app.lecture_notes import (
    LectureNote,
    LectureNoteDecisionAction,
    LectureNoteModelRequest,
    LectureNoteModelResult,
    LectureNoteRefinementRequest,
    LectureNoteRefinementResult,
    LectureNoteRefinementTopic,
    LectureNoteTopic,
)


def _live_request(text: str) -> LectureNoteModelRequest:
    return LectureNoteModelRequest(
        session_id="11111111-1111-4111-8111-111111111111",
        lesson_id="22222222-2222-4222-8222-222222222222",
        stt_session_id="attempt-1",
        current_topic_title=None,
        current_key_points=(),
        previous_topic_title=None,
        previous_context="",
        text=text,
    )


def _refinement_request() -> LectureNoteRefinementRequest:
    return LectureNoteRefinementRequest(
        session_id="11111111-1111-4111-8111-111111111111",
        lesson_id="22222222-2222-4222-8222-222222222222",
        note=LectureNote(
            topics=(LectureNoteTopic("topic-1", "주제", ("요점",)),),
            chunk_sequence=1,
        ),
    )


def _live_result(text: str = "요점") -> LectureNoteModelResult:
    return LectureNoteModelResult(
        action=LectureNoteDecisionAction.APPEND,
        topicTitle="주제",
        keyPoints=(text,),
    )


def _refinement_result() -> LectureNoteRefinementResult:
    return LectureNoteRefinementResult(
        topics=(LectureNoteRefinementTopic(topicTitle="주제", keyPoints=("요점",)),)
    )


async def _wait_until(predicate, *, timeout: float = 1.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0)


class BlockingDelegate:
    def __init__(self) -> None:
        self.release_live = asyncio.Event()
        self.release_refinement = asyncio.Event()
        self.live_active = 0
        self.refinement_active = 0
        self.max_active = 0
        self.max_refinement_active = 0
        self.order: list[str] = []
        self.closed = False

    async def generate(self, request):
        self.live_active += 1
        self.max_active = max(
            self.max_active,
            self.live_active + self.refinement_active,
        )
        self.order.append(f"live:{request.text}")
        try:
            await self.release_live.wait()
            return _live_result(request.text)
        finally:
            self.live_active -= 1

    async def refine(self, request):
        self.refinement_active += 1
        self.max_refinement_active = max(
            self.max_refinement_active,
            self.refinement_active,
        )
        self.max_active = max(
            self.max_active,
            self.live_active + self.refinement_active,
        )
        self.order.append("refinement")
        try:
            await self.release_refinement.wait()
            return _refinement_result()
        finally:
            self.refinement_active -= 1

    async def aclose(self) -> None:
        self.closed = True


def test_global_concurrency_is_bounded() -> None:
    async def scenario() -> None:
        delegate = BlockingDelegate()
        model = BoundedLectureNoteModel(delegate, max_concurrency=4)
        tasks = [
            asyncio.create_task(model.generate(_live_request(str(index))))
            for index in range(12)
        ]

        await _wait_until(lambda: delegate.live_active == 4)
        assert model.metrics_snapshot()["queued_live"] == 8
        delegate.release_live.set()
        await asyncio.gather(*tasks)

        assert delegate.max_active == 4
        metrics = model.metrics_snapshot()
        assert metrics["max_in_flight_observed"] == 4
        assert metrics["admissions_total"] == 12
        assert metrics["wait_ms_p95"] >= metrics["wait_ms_p50"]

    asyncio.run(scenario())


def test_refinement_has_its_own_concurrency_cap() -> None:
    async def scenario() -> None:
        delegate = BlockingDelegate()
        model = BoundedLectureNoteModel(
            delegate,
            max_concurrency=4,
            refinement_max_concurrency=1,
        )
        tasks = [
            asyncio.create_task(model.refine(_refinement_request()))
            for _ in range(3)
        ]

        await _wait_until(lambda: delegate.refinement_active == 1)
        assert model.metrics_snapshot()["queued_refinement"] == 2
        delegate.release_refinement.set()
        await asyncio.gather(*tasks)

        assert delegate.max_refinement_active == 1
        assert model.metrics_snapshot()["max_refinement_in_flight_observed"] == 1

    asyncio.run(scenario())


def test_live_priority_does_not_starve_refinement() -> None:
    async def scenario() -> None:
        delegate = BlockingDelegate()
        model = BoundedLectureNoteModel(
            delegate,
            max_concurrency=1,
            refinement_max_concurrency=1,
            max_consecutive_live=2,
        )
        blocker = asyncio.create_task(model.generate(_live_request("blocker")))
        await _wait_until(lambda: delegate.live_active == 1)
        refinement = asyncio.create_task(model.refine(_refinement_request()))
        live_one = asyncio.create_task(model.generate(_live_request("one")))
        live_two = asyncio.create_task(model.generate(_live_request("two")))
        await _wait_until(lambda: model.metrics_snapshot()["queued_live"] == 2)

        delegate.release_live.set()
        await _wait_until(lambda: delegate.refinement_active == 1)
        delegate.release_refinement.set()
        await asyncio.gather(blocker, refinement, live_one, live_two)

        assert delegate.order[:3] == ["live:blocker", "live:one", "refinement"]

    asyncio.run(scenario())


def test_cancelled_queued_call_does_not_leak_capacity() -> None:
    async def scenario() -> None:
        delegate = BlockingDelegate()
        model = BoundedLectureNoteModel(delegate, max_concurrency=1)
        active = asyncio.create_task(model.generate(_live_request("active")))
        await _wait_until(lambda: delegate.live_active == 1)
        queued = asyncio.create_task(model.generate(_live_request("queued")))
        await _wait_until(lambda: model.metrics_snapshot()["queued_live"] == 1)

        queued.cancel()
        with pytest.raises(asyncio.CancelledError):
            await queued
        assert model.metrics_snapshot()["queued_live"] == 0

        delegate.release_live.set()
        await active
        assert model.metrics_snapshot()["in_flight"] == 0

    asyncio.run(scenario())


class FlakyDelegate:
    def __init__(self, failures: list[Exception]) -> None:
        self.failures = failures
        self.calls = 0

    async def generate(self, request):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return _live_result(request.text)

    async def refine(self, request):
        return _refinement_result()

    async def aclose(self) -> None:
        return None


def _status_error(error_type, status_code: int, *, retry_after: str | None = None):
    headers = {} if retry_after is None else {"retry-after": retry_after}
    response = httpx.Response(
        status_code,
        headers=headers,
        request=httpx.Request("POST", "https://example.invalid/v1/chat/completions"),
    )
    return error_type("request failed", response=response, body=None)


def test_retryable_error_releases_slot_and_honors_retry_after() -> None:
    async def scenario() -> None:
        sleeps: list[float] = []

        async def fake_sleep(delay: float) -> None:
            sleeps.append(delay)

        delegate = FlakyDelegate([_status_error(RateLimitError, 429, retry_after="0.25")])
        model = BoundedLectureNoteModel(delegate, sleep=fake_sleep)

        result = await model.generate(_live_request("재시도"))

        assert result.keyPoints == ("재시도",)
        assert delegate.calls == 2
        assert sleeps == [0.25]
        assert model.metrics_snapshot()["retries_total"] == 1
        assert model.metrics_snapshot()["in_flight"] == 0

    asyncio.run(scenario())


def test_non_retryable_error_fails_immediately() -> None:
    async def scenario() -> None:
        delegate = FlakyDelegate([_status_error(BadRequestError, 400)])
        model = BoundedLectureNoteModel(delegate)

        with pytest.raises(BadRequestError):
            await model.generate(_live_request("잘못된 요청"))

        assert delegate.calls == 1
        assert model.metrics_snapshot()["retries_total"] == 0
        assert model.metrics_snapshot()["failures_total"] == 1

    asyncio.run(scenario())


def test_retryable_error_stops_at_max_attempts() -> None:
    async def scenario() -> None:
        sleeps: list[float] = []

        async def fake_sleep(delay: float) -> None:
            sleeps.append(delay)

        delegate = FlakyDelegate(
            [_status_error(RateLimitError, 429) for _ in range(3)]
        )
        model = BoundedLectureNoteModel(
            delegate,
            max_attempts=3,
            sleep=fake_sleep,
            jitter=lambda: 0.5,
        )

        with pytest.raises(RateLimitError):
            await model.generate(_live_request("상한"))

        assert delegate.calls == 3
        assert sleeps == [0.5, 1.0]
        assert model.metrics_snapshot()["retries_total"] == 2
        assert model.metrics_snapshot()["failures_total"] == 1

    asyncio.run(scenario())


def test_close_delegates_to_underlying_client() -> None:
    delegate = BlockingDelegate()
    delegate.release_live.set()
    model = BoundedLectureNoteModel(delegate)

    asyncio.run(model.aclose())

    assert delegate.closed is True
