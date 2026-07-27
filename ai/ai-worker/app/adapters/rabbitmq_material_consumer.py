from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import aio_pika
from aio_pika import DeliveryMode, IncomingMessage, Message

from app.consumers import PermanentMaterialJobError


logger = logging.getLogger(__name__)

MAIN_QUEUE = "ingestion.embed"
DEAD_LETTER_QUEUE = "ingestion.embed.dlq"
RETRY_HEADER = "x-ai-retry-count"
ERROR_HEADER = "x-ai-error-type"


class RabbitMaterialConsumer:
    """Consume Spring's existing queue without changing its declaration arguments."""

    def __init__(
        self,
        url: str,
        handler: Any,
        *,
        retry_limit: int = 3,
        retry_base_delay_seconds: float = 5.0,
        shutdown_grace_seconds: float = 30.0,
        readiness_interval_seconds: float = 1.0,
        readiness_check: Callable[[], Awaitable[bool]] | None = None,
        on_ready: Callable[[bool], None] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if retry_limit < 0:
            raise ValueError("retry_limit must be non-negative")
        if retry_base_delay_seconds < 0:
            raise ValueError("retry_base_delay_seconds must be non-negative")
        if shutdown_grace_seconds <= 0:
            raise ValueError("shutdown_grace_seconds must be positive")
        if readiness_interval_seconds <= 0:
            raise ValueError("readiness_interval_seconds must be positive")
        self._url = url
        self._handler = handler
        self._retry_limit = retry_limit
        self._retry_base_delay_seconds = retry_base_delay_seconds
        self._shutdown_grace_seconds = shutdown_grace_seconds
        self._readiness_interval_seconds = readiness_interval_seconds
        self._readiness_check = readiness_check or _always_ready
        self._on_ready = on_ready or (lambda _ready: None)
        self._sleep = sleep
        self._publish_exchange: Any | None = None
        self._active_tasks: set[asyncio.Task[object]] = set()

    async def run(self, stop_event: asyncio.Event) -> None:
        connection = await aio_pika.connect_robust(self._url)
        try:
            channel = await connection.channel(
                publisher_confirms=True,
                on_return_raises=True,
            )
            await channel.set_qos(prefetch_count=1)
            queue = await channel.get_queue(MAIN_QUEUE, ensure=True)
            await channel.declare_queue(DEAD_LETTER_QUEUE, durable=True)
            self._publish_exchange = channel.default_exchange
            consumer_tag = await queue.consume(self._dispatch, no_ack=False)
            try:
                await self._monitor_readiness(connection, stop_event)
            finally:
                self._on_ready(False)
                await queue.cancel(consumer_tag)
                await self._drain_active_tasks()
        finally:
            self._publish_exchange = None
            await connection.close()

    async def _dispatch(self, message: IncomingMessage) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._active_tasks.add(task)
        try:
            await self._handle_message(message)
        finally:
            if task is not None:
                self._active_tasks.discard(task)

    async def _handle_message(self, message: IncomingMessage) -> None:
        try:
            await self._handler.handle(message.body)
        except asyncio.CancelledError:
            raise
        except PermanentMaterialJobError as exc:
            await self._move_to_dead_letter(message, exc)
        except Exception as exc:
            try:
                retry_count = _retry_count(message.headers or {})
            except ValueError as header_error:
                await self._move_to_dead_letter(message, header_error)
                return

            if retry_count >= self._retry_limit:
                try:
                    await self._handler.report_retry_exhausted(message.body)
                except Exception:
                    logger.exception(
                        "failed to report exhausted material job",
                        extra={"event": "material_job.retry_exhausted_callback_failed"},
                    )
                await self._move_to_dead_letter(message, exc)
                return

            delay = min(300.0, self._retry_base_delay_seconds * (2**retry_count))
            await self._sleep(delay)
            headers = dict(message.headers or {})
            headers[RETRY_HEADER] = retry_count + 1
            headers[ERROR_HEADER] = type(exc).__name__
            await self._publish_then_ack(message, MAIN_QUEUE, headers)
        else:
            await message.ack()

    async def _move_to_dead_letter(
        self,
        message: IncomingMessage,
        error: Exception,
    ) -> None:
        headers = dict(message.headers or {})
        headers[ERROR_HEADER] = type(error).__name__
        await self._publish_then_ack(message, DEAD_LETTER_QUEUE, headers)

    async def _publish_then_ack(
        self,
        message: IncomingMessage,
        routing_key: str,
        headers: dict[str, Any],
    ) -> None:
        if self._publish_exchange is None:
            await message.nack(requeue=True)
            return
        try:
            await self._publish_exchange.publish(
                Message(
                    body=message.body,
                    headers=headers,
                    content_type=message.content_type or "application/json",
                    content_encoding=message.content_encoding,
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
                "failed to republish material job",
                extra={"event": "material_job.republish_failed", "routing_key": routing_key},
            )
            await message.nack(requeue=True)
            return
        await message.ack()

    async def _monitor_readiness(self, connection: Any, stop_event: asyncio.Event) -> None:
        previous: bool | None = None
        while not stop_event.is_set():
            connected = connection.connected.is_set()
            dependencies_ready = False
            if connected:
                try:
                    dependencies_ready = await self._readiness_check()
                except Exception:
                    logger.warning(
                        "ai-worker dependency readiness check failed",
                        exc_info=True,
                        extra={"event": "service.readiness_check_failed"},
                    )
            ready = connected and dependencies_ready
            if ready != previous:
                self._on_ready(ready)
                previous = ready
            try:
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=self._readiness_interval_seconds,
                )
            except TimeoutError:
                pass

    async def _drain_active_tasks(self) -> None:
        active = {task for task in self._active_tasks if not task.done()}
        if not active:
            return
        _, pending = await asyncio.wait(active, timeout=self._shutdown_grace_seconds)
        if not pending:
            return
        logger.warning(
            "material job shutdown grace expired",
            extra={"event": "material_job.shutdown_grace_expired", "pending": len(pending)},
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


def _retry_count(headers: dict[str, Any]) -> int:
    raw_value = headers.get(RETRY_HEADER, 0)
    if isinstance(raw_value, bool):
        raise ValueError("invalid retry header")
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid retry header") from exc
    if value < 0:
        raise ValueError("invalid retry header")
    return value


async def _always_ready() -> bool:
    return True
