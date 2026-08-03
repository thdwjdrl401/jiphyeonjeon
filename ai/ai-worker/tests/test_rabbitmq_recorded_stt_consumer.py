from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.recorded_stt.handler import PermanentRecordedSttJobError
from app.recorded_stt.rabbit_consumer import (
    DEAD_LETTER_QUEUE,
    MAIN_QUEUE,
    RETRY_HEADER,
    RabbitRecordedSttConsumer,
)


def _handler(error: Exception | None = None):
    return SimpleNamespace(
        handle=AsyncMock(side_effect=error),
        report_retry_exhausted=AsyncMock(),
    )


def _message(headers: dict | None = None):
    return SimpleNamespace(
        body=b'{"taskType":"RECORDED_STT"}',
        headers=headers or {},
        content_type="application/json",
        content_encoding="utf-8",
        correlation_id="correlation-1",
        message_id="message-1",
        type="recorded-stt-job",
        ack=AsyncMock(),
        nack=AsyncMock(),
    )


def _consumer(job_handler):
    instance = RabbitRecordedSttConsumer(
        "amqp://liveclass:secret@localhost/",
        job_handler,
        retry_limit=3,
        retry_base_delay_seconds=0,
        shutdown_grace_seconds=30,
        on_ready=lambda _ready: None,
        sleep=AsyncMock(),
    )
    exchange = AsyncMock()
    instance._exchange = exchange
    return instance, exchange


async def test_success_acks_only_after_spring_terminal_callback_returns() -> None:
    events: list[str] = []
    handler = _handler()
    handler.handle.side_effect = lambda _body: events.append("terminal-accepted")
    incoming = _message()
    incoming.ack.side_effect = lambda: events.append("acked")
    consumer, exchange = _consumer(handler)

    await consumer._handle(incoming)

    assert events == ["terminal-accepted", "acked"]
    exchange.publish.assert_not_awaited()


async def test_permanent_failure_is_preserved_in_the_dedicated_dlq() -> None:
    consumer, exchange = _consumer(_handler(PermanentRecordedSttJobError("invalid")))
    incoming = _message()

    await consumer._handle(incoming)

    assert exchange.publish.await_args.kwargs["routing_key"] == DEAD_LETTER_QUEUE
    incoming.ack.assert_awaited_once_with()


async def test_transient_failure_republishes_with_a_bounded_retry_header() -> None:
    consumer, exchange = _consumer(_handler(RuntimeError("temporary")))
    incoming = _message({RETRY_HEADER: 1})

    await consumer._handle(incoming)

    (published,) = exchange.publish.await_args.args
    assert exchange.publish.await_args.kwargs["routing_key"] == MAIN_QUEUE
    assert published.headers[RETRY_HEADER] == 2
    incoming.ack.assert_awaited_once_with()


async def test_exhausted_message_is_requeued_if_terminal_callback_is_temporarily_unavailable() -> None:
    handler = _handler(RuntimeError("temporary"))
    handler.report_retry_exhausted.side_effect = RuntimeError("Spring unavailable")
    consumer, exchange = _consumer(handler)
    incoming = _message({RETRY_HEADER: 3})

    await consumer._handle(incoming)

    incoming.nack.assert_awaited_once_with(requeue=True)
    incoming.ack.assert_not_awaited()
    exchange.publish.assert_not_awaited()


async def test_exhausted_message_moves_to_dlq_after_failure_callback_is_accepted() -> None:
    handler = _handler(RuntimeError("temporary"))
    consumer, exchange = _consumer(handler)
    incoming = _message({RETRY_HEADER: 3})

    await consumer._handle(incoming)

    handler.report_retry_exhausted.assert_awaited_once_with(incoming.body)
    assert exchange.publish.await_args.kwargs["routing_key"] == DEAD_LETTER_QUEUE
    incoming.ack.assert_awaited_once_with()
