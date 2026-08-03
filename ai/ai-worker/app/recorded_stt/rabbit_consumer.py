from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import aio_pika
from aio_pika import DeliveryMode, IncomingMessage, Message

from app.recorded_stt.handler import PermanentRecordedSttJobError

logger = logging.getLogger(__name__)

MAIN_QUEUE = "ingestion.transcribe"
DEAD_LETTER_QUEUE = "ingestion.transcribe.dlq"
RETRY_HEADER = "x-recorded-stt-retry-count"
ERROR_HEADER = "x-recorded-stt-error-type"


class RabbitRecordedSttConsumer:
    def __init__(
        self,
        url: str,
        handler: Any,
        *,
        retry_limit: int,
        retry_base_delay_seconds: float,
        shutdown_grace_seconds: float,
        on_ready: Callable[[bool], None],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._url = url
        self._handler = handler
        self._retry_limit = retry_limit
        self._retry_base_delay = retry_base_delay_seconds
        self._shutdown_grace = shutdown_grace_seconds
        self._on_ready = on_ready
        self._sleep = sleep
        self._exchange: Any | None = None
        self._active_tasks: set[asyncio.Task[object]] = set()

    async def run(self, stop_event: asyncio.Event) -> None:
        connection = await aio_pika.connect_robust(self._url)
        try:
            channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
            await channel.set_qos(prefetch_count=1)
            queue = await channel.get_queue(MAIN_QUEUE, ensure=True)
            await channel.declare_queue(DEAD_LETTER_QUEUE, durable=True)
            self._exchange = channel.default_exchange
            consumer_tag = await queue.consume(self._dispatch, no_ack=False)
            self._on_ready(True)
            try:
                await stop_event.wait()
            finally:
                self._on_ready(False)
                await queue.cancel(consumer_tag)
                await self._drain()
        finally:
            self._exchange = None
            await connection.close()

    async def _dispatch(self, message: IncomingMessage) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._active_tasks.add(task)
        try:
            await self._handle(message)
        finally:
            if task is not None:
                self._active_tasks.discard(task)

    async def _handle(self, message: IncomingMessage) -> None:
        try:
            await self._handler.handle(message.body)
        except asyncio.CancelledError:
            raise
        except PermanentRecordedSttJobError as exc:
            await self._dead_letter(message, exc)
        # Unknown infrastructure/runtime faults are retryable; the bounded counter still sends
        # the message to the DLQ and reports a terminal failure when attempts are exhausted.
        except Exception as exc:  # noqa: BLE001
            try:
                retry_count = _retry_count(message.headers or {})
            except (TypeError, ValueError) as header_error:
                await self._dead_letter(message, header_error)
                return
            if retry_count >= self._retry_limit:
                try:
                    await self._handler.report_retry_exhausted(message.body)
                except PermanentRecordedSttJobError as terminal_error:
                    await self._dead_letter(message, terminal_error)
                    return
                except Exception:
                    # A transient Spring outage must not strand a PROCESSING job in the DLQ.
                    # Keep the original delivery until its terminal callback is durably accepted.
                    logger.exception(
                        "failed to report exhausted recorded STT job",
                        extra={"event": "recorded_stt.retry_exhausted_callback_failed"},
                    )
                    await message.nack(requeue=True)
                    return
                await self._dead_letter(message, exc)
                return
            await self._sleep(min(300.0, self._retry_base_delay * (2**retry_count)))
            headers = dict(message.headers or {})
            headers[RETRY_HEADER] = retry_count + 1
            headers[ERROR_HEADER] = type(exc).__name__
            await self._publish_then_ack(message, MAIN_QUEUE, headers)
        else:
            await message.ack()

    async def _dead_letter(self, message: IncomingMessage, error: Exception) -> None:
        headers = dict(message.headers or {})
        headers[ERROR_HEADER] = type(error).__name__
        await self._publish_then_ack(message, DEAD_LETTER_QUEUE, headers)

    async def _publish_then_ack(
        self,
        message: IncomingMessage,
        routing_key: str,
        headers: dict[str, Any],
    ) -> None:
        if self._exchange is None:
            await message.nack(requeue=True)
            return
        try:
            await self._exchange.publish(
                Message(
                    body=message.body,
                    headers=headers,
                    content_type=message.content_type or "application/json",
                    delivery_mode=DeliveryMode.PERSISTENT,
                    correlation_id=message.correlation_id,
                    message_id=message.message_id,
                    type=message.type,
                ),
                routing_key=routing_key,
                mandatory=True,
            )
        except Exception:
            logger.exception(
                "failed to republish recorded STT job",
                extra={"event": "recorded_stt.republish_failed", "routing_key": routing_key},
            )
            await message.nack(requeue=True)
            return
        await message.ack()

    async def _drain(self) -> None:
        active = {task for task in self._active_tasks if not task.done()}
        if not active:
            return
        _, pending = await asyncio.wait(active, timeout=self._shutdown_grace)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


def _retry_count(headers: dict[str, Any]) -> int:
    raw = headers.get(RETRY_HEADER, 0)
    if isinstance(raw, bool):
        raise TypeError("invalid recorded STT retry header")
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid recorded STT retry header") from exc
    if value < 0:
        raise ValueError("invalid recorded STT retry header")
    return value
