from __future__ import annotations

from collections.abc import AsyncIterable, AsyncIterator

from app.rag.models import AnswerEvent


def encode_sse_event(event: AnswerEvent) -> bytes:
    payload = event.data.model_dump_json()
    return f"event: {event.event}\ndata: {payload}\n\n".encode()


async def encode_sse_stream(events: AsyncIterable[AnswerEvent]) -> AsyncIterator[bytes]:
    try:
        async for event in events:
            yield encode_sse_event(event)
    finally:
        close = getattr(events, "aclose", None)
        if close is not None:
            await close()
