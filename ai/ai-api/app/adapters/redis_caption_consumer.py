from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError, ResponseError

logger = logging.getLogger(__name__)

CAPTION_STREAM_KEY = "ai:captions:live"
CAPTION_CONSUMER_GROUP = "ai-rag-live-v1"


class RedisClient(Protocol):
    async def ping(self) -> object: ...

    async def xgroup_create(
        self,
        name: str,
        groupname: str,
        id: str,
        *,
        mkstream: bool,
    ) -> object: ...

    async def xreadgroup(
        self,
        groupname: str,
        consumername: str,
        streams: Mapping[str, str],
        *,
        count: int,
        block: int | None = None,
    ) -> list[Any]: ...

    async def xack(self, name: str, groupname: str, *ids: str) -> int: ...

    async def xinfo_groups(self, name: str) -> list[Mapping[Any, Any]]: ...

    async def xpending(self, name: str, groupname: str) -> Mapping[Any, Any]: ...

    async def xpending_range(
        self,
        name: str,
        groupname: str,
        min: str,
        max: str,
        count: int,
        consumername: str | None = None,
    ) -> list[Mapping[Any, Any]]: ...

    async def xrange(
        self,
        name: str,
        min: str = "-",
        max: str = "+",
        count: int | None = None,
    ) -> list[Any]: ...

    async def aclose(self) -> None: ...


@dataclass(slots=True)
class CaptionConsumerState:
    connected: bool = False
    degraded: bool = True
    lag: int | None = None
    pending: int | None = None
    consumed_total: int = 0
    acked_total: int = 0
    invalid_total: int = 0
    ack_miss_total: int = 0
    reconnect_total: int = 0
    processing_error_total: int = 0
    last_success_at: datetime | None = None
    last_error_code: str | None = None

    def mark_connected(self) -> None:
        self.connected = True
        self.degraded = False
        self.last_error_code = None

    def mark_degraded(self, error_code: str) -> None:
        self.connected = False
        self.degraded = True
        self.last_error_code = error_code

    def metrics_snapshot(self) -> dict[str, int | float]:
        metrics: dict[str, int | float] = {
            "consumer_connected": int(self.connected),
            "consumer_degraded": int(self.degraded),
            "entries_consumed_total": self.consumed_total,
            "entries_acked_total": self.acked_total,
            "entries_invalid_total": self.invalid_total,
            "entries_ack_miss_total": self.ack_miss_total,
            "consumer_reconnect_total": self.reconnect_total,
            "processing_error_total": self.processing_error_total,
        }
        if self.lag is not None:
            metrics["consumer_lag"] = self.lag
        if self.pending is not None:
            metrics["consumer_pending"] = self.pending
        if self.last_success_at is not None:
            metrics["consumer_last_success_age_seconds"] = max(
                0.0,
                time.time() - self.last_success_at.timestamp(),
            )
        return metrics


class RedisCaptionConsumer:
    """Consume caption entries with a stable consumer name and ACK after handling."""

    def __init__(
        self,
        redis_url: str,
        consumer_name: str,
        handle_entry: Callable[[Mapping[Any, Any]], object],
        *,
        after_ack: Callable[[Mapping[Any, Any]], object] | None = None,
        state: CaptionConsumerState | None = None,
        stream_key: str = CAPTION_STREAM_KEY,
        group_name: str = CAPTION_CONSUMER_GROUP,
        batch_size: int = 100,
        block_ms: int = 1_000,
        reconnect_min_seconds: float = 0.25,
        reconnect_max_seconds: float = 5.0,
        socket_connect_timeout_seconds: float = 2.0,
        socket_timeout_seconds: float = 15.0,
        client_factory: Callable[[], RedisClient] | None = None,
    ) -> None:
        if not redis_url or not consumer_name or not stream_key or not group_name:
            raise ValueError("Redis caption consumer identifiers are required")
        if min(batch_size, block_ms) <= 0:
            raise ValueError("batch_size and block_ms must be positive")
        if reconnect_min_seconds <= 0 or reconnect_max_seconds < reconnect_min_seconds:
            raise ValueError("invalid Redis reconnect interval")
        if socket_connect_timeout_seconds <= 0 or socket_timeout_seconds <= 0:
            raise ValueError("Redis socket timeouts must be positive")
        if socket_timeout_seconds <= block_ms / 1_000:
            raise ValueError("Redis socket timeout must exceed the blocking poll interval")
        self.state = state or CaptionConsumerState()
        self._redis_url = redis_url
        self._consumer_name = consumer_name
        self._handle_entry = handle_entry
        self._after_ack = after_ack
        self._stream_key = stream_key
        self._group_name = group_name
        self._batch_size = batch_size
        self._block_ms = block_ms
        self._reconnect_min_seconds = reconnect_min_seconds
        self._reconnect_max_seconds = reconnect_max_seconds
        self._socket_connect_timeout_seconds = socket_connect_timeout_seconds
        self._socket_timeout_seconds = socket_timeout_seconds
        self._client_factory = client_factory or self._new_client

    @property
    def consumer_name(self) -> str:
        return self._consumer_name

    @property
    def group_name(self) -> str:
        return self._group_name

    @property
    def stream_key(self) -> str:
        return self._stream_key

    def _new_client(self) -> RedisClient:
        return Redis.from_url(
            self._redis_url,
            decode_responses=False,
            socket_connect_timeout=self._socket_connect_timeout_seconds,
            socket_timeout=self._socket_timeout_seconds,
        )

    async def run(self, stop_event: asyncio.Event) -> None:
        delay = self._reconnect_min_seconds
        while not stop_event.is_set():
            client: RedisClient | None = None
            try:
                client = self._client_factory()
                await client.ping()
                await self._ensure_group(client)
                self.state.mark_connected()
                await self._drain_owned_pending(client, stop_event)
                delay = self._reconnect_min_seconds
                while not stop_event.is_set():
                    messages = await client.xreadgroup(
                        self._group_name,
                        self._consumer_name,
                        {self._stream_key: ">"},
                        count=self._batch_size,
                        block=self._block_ms,
                    )
                    if messages:
                        await self._process_messages(client, messages)
                    await self._refresh_group_state(client)
            except asyncio.CancelledError:
                raise
            except (RedisError, OSError, TimeoutError) as exc:
                self.state.mark_degraded(type(exc).__name__)
                logger.warning(
                    "caption Redis consumer degraded",
                    extra={
                        "event": "caption.consumer_degraded",
                        "error_code": type(exc).__name__,
                    },
                )
            except Exception as exc:
                self.state.mark_degraded("CAPTION_CONSUMER_ERROR")
                logger.error(
                    "caption consumer iteration failed",
                    extra={
                        "event": "caption.consumer_failed",
                        "error_code": type(exc).__name__,
                    },
                )
            finally:
                self.state.connected = False
                if client is not None:
                    await self._close_client_safely(client)

            if not stop_event.is_set():
                self.state.reconnect_total += 1
                if await _wait_or_stop(stop_event, delay):
                    break
                delay = min(delay * 2, self._reconnect_max_seconds)

    async def _ensure_group(self, client: RedisClient) -> None:
        try:
            await client.xgroup_create(
                self._stream_key,
                self._group_name,
                "0-0",
                mkstream=True,
            )
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    async def _drain_owned_pending(
        self,
        client: RedisClient,
        stop_event: asyncio.Event | None = None,
    ) -> None:
        while stop_event is None or not stop_event.is_set():
            pending = await client.xpending_range(
                self._stream_key,
                self._group_name,
                "-",
                "+",
                self._batch_size,
                consumername=self._consumer_name,
            )
            if not pending:
                return
            for pending_entry in pending:
                if stop_event is not None and stop_event.is_set():
                    return
                entry_id = _decode_text(_mapping_value(pending_entry, "message_id"))
                entries = await client.xrange(
                    self._stream_key,
                    min=entry_id,
                    max=entry_id,
                    count=1,
                )
                if entries:
                    await self._process_messages(client, [[self._stream_key, entries]])
                    continue

                self.state.consumed_total += 1
                self.state.invalid_total += 1
                await self._ack_entry(client, entry_id)
                logger.warning(
                    "trimmed pending caption entry dropped",
                    extra={
                        "event": "caption.pending_entry_dropped",
                        "redis_entry_id": entry_id,
                        "error_code": "CAPTION_PENDING_PAYLOAD_MISSING",
                    },
                )

    async def _process_messages(self, client: RedisClient, messages: list[Any]) -> None:
        for _, entries in messages:
            for entry_id, raw_fields in entries:
                self.state.consumed_total += 1
                handled = False
                try:
                    result = self._handle_entry(raw_fields)
                    if inspect.isawaitable(result):
                        await result
                    handled = True
                except (UnicodeError, ValueError) as exc:
                    self.state.invalid_total += 1
                    logger.warning(
                        "invalid caption entry dropped",
                        extra={
                            "event": "caption.entry_dropped",
                            "redis_entry_id": _decode_text(entry_id),
                            "error_code": type(exc).__name__,
                        },
                    )
                except Exception:
                    self.state.processing_error_total += 1
                    raise
                acked = await self._ack_entry(client, _decode_text(entry_id))
                if handled and acked and self._after_ack is not None:
                    try:
                        result = self._after_ack(raw_fields)
                        if inspect.isawaitable(result):
                            await result
                    except Exception as exc:
                        logger.warning(
                            "caption post-ACK handler failed",
                            extra={
                                "event": "caption.post_ack_failed",
                                "redis_entry_id": _decode_text(entry_id),
                                "error_code": type(exc).__name__,
                            },
                        )

    async def _ack_entry(self, client: RedisClient, entry_id: str) -> bool:
        acked = await client.xack(
            self._stream_key,
            self._group_name,
            entry_id,
        )
        if int(acked) != 1:
            self.state.ack_miss_total += 1
            logger.warning(
                "caption entry ACK did not remove a pending entry",
                extra={
                    "event": "caption.entry_ack_missed",
                    "redis_entry_id": entry_id,
                    "error_code": "CAPTION_ACK_MISSED",
                },
            )
            return False
        self.state.acked_total += 1
        self.state.last_success_at = datetime.now(UTC)
        return True

    async def _refresh_group_state(self, client: RedisClient) -> None:
        groups = await client.xinfo_groups(self._stream_key)
        matching = next(
            (
                group
                for group in groups
                if _decode_text(_mapping_value(group, "name")) == self._group_name
            ),
            None,
        )
        lag = None if matching is None else _mapping_value(matching, "lag")
        self.state.lag = int(lag) if lag is not None else None
        pending = await client.xpending(self._stream_key, self._group_name)
        pending_count = _mapping_value(pending, "pending")
        if pending_count is None:
            pending_count = _mapping_value(pending, "count")
        self.state.pending = int(pending_count) if pending_count is not None else None

    async def _close_client_safely(self, client: RedisClient) -> None:
        try:
            await _close_client(client)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.state.mark_degraded(type(exc).__name__)
            logger.warning(
                "caption Redis client close failed",
                extra={
                    "event": "caption.consumer_close_failed",
                    "error_code": type(exc).__name__,
                },
            )


def _mapping_value(mapping: Mapping[Any, Any], key: str) -> Any:
    if key in mapping:
        return mapping[key]
    return mapping.get(key.encode("utf-8"))


def _decode_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise ValueError("Redis caption fields must be strings")


async def _close_client(client: RedisClient) -> None:
    close_result = client.aclose()
    if inspect.isawaitable(close_result):
        await close_result


async def _wait_or_stop(stop_event: asyncio.Event, delay: float) -> bool:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=delay)
    except TimeoutError:
        return False
    return True
