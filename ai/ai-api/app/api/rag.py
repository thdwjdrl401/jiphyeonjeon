from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.internal_auth import InternalAuthenticationError, InternalRequestAuthenticator
from app.rag import (
    DuplicateRequestError,
    RagAnswerRequest,
    RagAnswerService,
    RequestRegistryFullError,
    encode_sse_stream,
)

RAG_ROUTE_PREFIX = "/internal/v1/rag"
RAG_STREAM_PATH = f"{RAG_ROUTE_PREFIX}/answers:stream"


def create_rag_router(
    service: RagAnswerService | None,
    authenticator: InternalRequestAuthenticator | None,
) -> APIRouter:
    async def require_internal_auth(
        request: Request,
        x_internal_signature: Annotated[str | None, Header()] = None,
    ) -> None:
        if authenticator is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="internal authentication is not configured",
            )
        raw_body = await request.body()
        try:
            await authenticator.authenticate(raw_body, x_internal_signature)
        except InternalAuthenticationError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid internal credentials",
            ) from exc

    router = APIRouter(
        prefix=RAG_ROUTE_PREFIX,
        tags=["internal-rag"],
        dependencies=[Depends(require_internal_auth)],
    )

    @router.post("/answers:stream", response_class=StreamingResponse)
    async def stream_answer(
        request: RagAnswerRequest,
        accept: Annotated[str | None, Header()] = None,
    ) -> StreamingResponse:
        if not _accepts_event_stream(accept):
            raise HTTPException(
                status_code=status.HTTP_406_NOT_ACCEPTABLE,
                detail="Accept must include text/event-stream",
            )
        if service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="RAG service is not configured",
            )
        try:
            events = await service.open(request)
        except DuplicateRequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="requestId was already used",
            ) from exc
        except RequestRegistryFullError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="too many active RAG requests",
            ) from exc
        return StreamingResponse(
            encode_sse_stream(events),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    return router


def _accepts_event_stream(accept: str | None) -> bool:
    if accept is None:
        return False
    media_types = {part.split(";", 1)[0].strip().lower() for part in accept.split(",")}
    return "text/event-stream" in media_types
