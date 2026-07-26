from __future__ import annotations

import asyncio
import logging
import secrets
from collections import deque
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Annotated, Literal, Protocol

import uvicorn
from fastapi import FastAPI, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings, load_settings
from app.embedding import BgeM3EmbeddingModel

logger = logging.getLogger(__name__)

EmbeddingVector = Annotated[list[float], Field(min_length=1024, max_length=1024)]


class EmbeddingRuntime(Protocol):
    async def warmup(self) -> None: ...

    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    revision: str = Field(min_length=1)
    texts: list[str] = Field(min_length=1)


class EmbeddingResponse(BaseModel):
    model: str
    revision: str
    dimensions: Literal[1024]
    normalized: Literal[True]
    embeddings: list[EmbeddingVector]


class _AdmissionGate:
    """Bound active and queued requests on one application event loop."""

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._inflight = 0

    def enter(self) -> bool:
        if self._inflight >= self._limit:
            return False
        self._inflight += 1
        return True

    def leave(self) -> None:
        if self._inflight <= 0:
            raise RuntimeError("embedding admission counter underflow")
        self._inflight -= 1


class _InternalBoundaryMiddleware:
    """Authenticate and bound internal request bodies before FastAPI parses them."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        token: str,
        max_body_bytes: int,
        body_timeout_seconds: float,
        admission: _AdmissionGate,
    ) -> None:
        self._app = app
        self._token = token
        self._max_body_bytes = max_body_bytes
        self._body_timeout_seconds = body_timeout_seconds
        self._admission = admission

    def _is_authenticated(self, authorization: str | None) -> bool:
        scheme, separator, token = (authorization or "").partition(" ")
        return bool(
            separator
            and scheme.lower() == "bearer"
            and secrets.compare_digest(token.encode(), self._token.encode())
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/internal/"):
            await self._app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        if not self._is_authenticated(headers.get("Authorization")):
            await JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "unauthorized"},
                headers={"WWW-Authenticate": "Bearer"},
            )(scope, receive, send)
            return

        content_length = headers.get("Content-Length")
        if content_length is not None:
            try:
                declared_bytes = int(content_length)
            except ValueError:
                await JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "invalid content length"},
                )(scope, receive, send)
                return
            if declared_bytes < 0:
                await JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "invalid content length"},
                )(scope, receive, send)
                return
            if declared_bytes > self._max_body_bytes:
                await self._reject_oversized(scope, receive, send)
                return

        if not self._admission.enter():
            await JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "embedding runtime overloaded"},
                headers={"Retry-After": "1"},
            )(scope, receive, send)
            return

        try:
            received_bytes = 0
            buffered_messages: deque[Message] = deque()
            try:
                async with asyncio.timeout(self._body_timeout_seconds):
                    while True:
                        message = await receive()
                        buffered_messages.append(message)
                        if message["type"] == "http.request":
                            received_bytes += len(message.get("body", b""))
                            if received_bytes > self._max_body_bytes:
                                await self._reject_oversized(scope, receive, send)
                                return
                            if not message.get("more_body", False):
                                break
                        elif message["type"] == "http.disconnect":
                            break
            except TimeoutError:
                await JSONResponse(
                    status_code=status.HTTP_408_REQUEST_TIMEOUT,
                    content={"detail": "request body timeout"},
                )(scope, receive, send)
                return

            async def replay_receive() -> Message:
                if buffered_messages:
                    return buffered_messages.popleft()
                return await receive()

            await self._app(scope, replay_receive, send)
        finally:
            self._admission.leave()

    @staticmethod
    async def _reject_oversized(scope: Scope, receive: Receive, send: Send) -> None:
        await JSONResponse(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            content={"detail": "request body too large"},
        )(scope, receive, send)


def create_app(settings: Settings, embedding: EmbeddingRuntime) -> FastAPI:
    ready = False
    admission = _AdmissionGate(settings.max_inflight_requests)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        nonlocal ready
        await embedding.warmup()
        ready = True
        logger.info("bge-runtime ready", extra={"event": "service.ready"})
        try:
            yield
        finally:
            ready = False
            logger.info("bge-runtime stopped", extra={"event": "service.stopped"})

    app = FastAPI(title="LiveClass BGE Runtime", lifespan=lifespan)
    app.add_middleware(
        _InternalBoundaryMiddleware,
        token=settings.internal_token.get_secret_value(),
        max_body_bytes=settings.max_request_body_bytes,
        body_timeout_seconds=settings.request_body_timeout_seconds,
        admission=admission,
    )

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "bge-runtime"}

    @app.get("/readyz")
    async def readiness(response: Response) -> dict[str, str]:
        if not ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "not_ready", "service": "bge-runtime"}
        return {"status": "ready", "service": "bge-runtime"}

    @app.post("/internal/v1/embeddings")
    async def create_embeddings(request: EmbeddingRequest) -> EmbeddingResponse:
        if request.model != settings.model or request.revision != settings.revision:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="model mismatch")
        if len(request.texts) > settings.max_batch_size:
            raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE)
        if any(not text.strip() or len(text) > settings.max_text_chars for text in request.texts):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)
        vectors = await embedding.embed(request.texts)

        if len(vectors) != len(request.texts):
            raise RuntimeError("embedding runtime returned an unexpected vector count")
        logger.debug(
            "embedding batch completed",
            extra={"event": "embedding.completed", "batch_size": len(request.texts)},
        )
        return EmbeddingResponse(
            model=settings.model,
            revision=settings.revision,
            dimensions=1024,
            normalized=True,
            embeddings=vectors,
        )

    app.state.settings = settings
    app.state.embedding = embedding
    return app


def run() -> None:
    settings = load_settings()
    embedding = BgeM3EmbeddingModel(
        settings.model,
        settings.revision,
        device=settings.device,
        batch_size=settings.batch_size,
    )
    uvicorn.run(
        create_app(settings, embedding),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    run()
