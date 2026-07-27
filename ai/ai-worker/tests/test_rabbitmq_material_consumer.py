import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.adapters.rabbitmq_material_consumer import (
    DEAD_LETTER_QUEUE,
    ERROR_HEADER,
    MAIN_QUEUE,
    RETRY_HEADER,
    RabbitMaterialConsumer,
)
from app.consumers import PermanentMaterialJobError


def handler(error: Exception | None = None):
    return SimpleNamespace(
        handle=AsyncMock(side_effect=error),
        report_retry_exhausted=AsyncMock(),
    )


def message(headers: dict | None = None):
    return SimpleNamespace(
        body=b'{"taskType":"PPTX_EMBED"}',
        headers=headers or {},
        content_type="application/json",
        content_encoding="utf-8",
        correlation_id="correlation-1",
        message_id="message-1",
        type="material-job",
        ack=AsyncMock(),
        nack=AsyncMock(),
    )


def consumer(job_handler, *, sleep=None) -> tuple[RabbitMaterialConsumer, AsyncMock]:
    sleeper = sleep or AsyncMock()
    instance = RabbitMaterialConsumer(
        "amqp://liveclass:secret@localhost/",
        job_handler,
        retry_base_delay_seconds=5,
        sleep=sleeper,
    )
    exchange = AsyncMock()
    instance._publish_exchange = exchange
    return instance, exchange


async def test_success_acks_only_after_handler() -> None:
    events = []
    job_handler = handler()
    job_handler.handle.side_effect = lambda _body: events.append("handled")
    instance, exchange = consumer(job_handler)
    incoming = message()
    incoming.ack.side_effect = lambda: events.append("acked")

    await instance._handle_message(incoming)

    assert events == ["handled", "acked"]
    exchange.publish.assert_not_awaited()
    incoming.nack.assert_not_awaited()


async def test_permanent_failure_is_preserved_in_dead_letter_queue() -> None:
    instance, exchange = consumer(handler(PermanentMaterialJobError("invalid")))
    incoming = message()

    await instance._handle_message(incoming)

    (published,) = exchange.publish.await_args.args
    assert exchange.publish.await_args.kwargs["routing_key"] == DEAD_LETTER_QUEUE
    assert published.body == incoming.body
    assert published.headers[ERROR_HEADER] == "PermanentMaterialJobError"
    incoming.ack.assert_awaited_once_with()
    incoming.nack.assert_not_awaited()


async def test_transient_failure_republishes_with_bounded_attempt_header() -> None:
    sleeper = AsyncMock()
    instance, exchange = consumer(handler(RuntimeError("temporary")), sleep=sleeper)
    incoming = message({RETRY_HEADER: 1})

    await instance._handle_message(incoming)

    sleeper.assert_awaited_once_with(10)
    (published,) = exchange.publish.await_args.args
    assert exchange.publish.await_args.kwargs["routing_key"] == MAIN_QUEUE
    assert published.headers[RETRY_HEADER] == 2
    assert published.headers[ERROR_HEADER] == "RuntimeError"
    incoming.ack.assert_awaited_once_with()


async def test_retry_exhaustion_reports_then_moves_to_dead_letter_queue() -> None:
    job_handler = handler(RuntimeError("temporary"))
    instance, exchange = consumer(job_handler)
    incoming = message({RETRY_HEADER: 3})

    await instance._handle_message(incoming)

    job_handler.report_retry_exhausted.assert_awaited_once_with(incoming.body)
    assert exchange.publish.await_args.kwargs["routing_key"] == DEAD_LETTER_QUEUE
    incoming.ack.assert_awaited_once_with()


async def test_malformed_retry_header_moves_to_dead_letter_queue() -> None:
    instance, exchange = consumer(handler(RuntimeError("temporary")))
    incoming = message({RETRY_HEADER: "not-a-number"})

    await instance._handle_message(incoming)

    assert exchange.publish.await_args.kwargs["routing_key"] == DEAD_LETTER_QUEUE
    incoming.ack.assert_awaited_once_with()


async def test_publish_failure_requeues_original_without_ack() -> None:
    instance, exchange = consumer(handler(RuntimeError("temporary")))
    exchange.publish.side_effect = RuntimeError("broker publish failed")
    incoming = message()

    await instance._handle_message(incoming)

    incoming.nack.assert_awaited_once_with(requeue=True)
    incoming.ack.assert_not_awaited()


async def test_readiness_requires_both_broker_and_database() -> None:
    states = []
    connected = asyncio.Event()
    connected.set()
    database_ready = AsyncMock(side_effect=[False, True])
    instance = RabbitMaterialConsumer(
        "amqp://liveclass:secret@localhost/",
        handler(),
        readiness_check=database_ready,
        on_ready=states.append,
        readiness_interval_seconds=0.001,
    )
    stop_event = asyncio.Event()

    task = asyncio.create_task(
        instance._monitor_readiness(SimpleNamespace(connected=connected), stop_event)
    )
    while database_ready.await_count < 2:
        await asyncio.sleep(0)
    stop_event.set()
    await task

    assert states == [False, True]
