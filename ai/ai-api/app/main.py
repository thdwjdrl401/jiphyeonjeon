import logging
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.adapters import HmacInternalRequestAuthenticator
from app.api import (
    RAG_STREAM_PATH,
    RAG_V2_STREAM_PATH,
    InternalRequestAuthenticator,
    create_rag_router,
    create_rag_router_v2,
)
from app.config import Settings, load_settings
from app.logging_config import configure_logging
from app.rag import RagAnswerService, ReplayAnswerService
from app.runtime import CaptionRuntime, RuntimeState
from app.wiring import (
    LectureNoteServices,
    RagServices,
    ReplayServices,
    build_lecture_note_services,
    build_rag_services,
    build_replay_rag_services,
)

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    runtime: RuntimeState | None = None,
    *,
    rag_service: RagAnswerService | None = None,
    internal_authenticator: InternalRequestAuthenticator | None = None,
    rag_services: RagServices | None = None,
    lecture_note_services: LectureNoteServices | None = None,
    replay_rag_service: ReplayAnswerService | None = None,
    replay_services: ReplayServices | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings()
    resolved_runtime = runtime or RuntimeState()
    if rag_service is not None and rag_services is not None:
        raise ValueError("provide rag_service or rag_services, not both")
    if replay_rag_service is not None and replay_services is not None:
        raise ValueError("provide replay_rag_service or replay_services, not both")
    resolved_rag_service = rag_services.service if rag_services is not None else rag_service
    resolved_replay_service = (
        replay_services.service if replay_services is not None else replay_rag_service
    )
    caption_runtime = (
        CaptionRuntime(
            rag_services.context.consumer,
            rag_services.context.consumer_state,
            shutdown_timeout_seconds=resolved_settings.caption_shutdown_timeout_seconds,
            cancel_grace_seconds=resolved_settings.caption_cancel_grace_seconds,
        )
        if rag_services is not None
        else None
    )
    lecture_note_runtime = (
        CaptionRuntime(
            lecture_note_services.consumer,
            lecture_note_services.consumer_state,
            shutdown_timeout_seconds=resolved_settings.caption_shutdown_timeout_seconds,
            cancel_grace_seconds=resolved_settings.caption_cancel_grace_seconds,
            task_name="lecture-note-consumer",
        )
        if lecture_note_services is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if lecture_note_services is not None:
            await lecture_note_services.restore()
        if caption_runtime is not None:
            caption_runtime.start()
        if lecture_note_runtime is not None:
            lecture_note_runtime.start()
        resolved_runtime.ready = True
        logger.info("ai-api ready", extra={"event": "service.ready"})
        try:
            yield
        finally:
            resolved_runtime.ready = False
            await _shutdown_services(
                lecture_note_runtime=lecture_note_runtime,
                caption_runtime=caption_runtime,
                lecture_note_services=lecture_note_services,
                rag_services=rag_services,
                replay_services=replay_services,
            )
            logger.info("ai-api stopped", extra={"event": "service.stopped"})

    app = FastAPI(title="LiveClass AI API", lifespan=lifespan)
    app.include_router(create_rag_router(resolved_rag_service, internal_authenticator))
    app.include_router(create_rag_router_v2(resolved_replay_service, internal_authenticator))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> Response:
        if request.url.path in (RAG_STREAM_PATH, RAG_V2_STREAM_PATH):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "invalid RAG request"},
            )
        return await request_validation_exception_handler(request, exc)

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-api"}

    @app.get("/readyz")
    async def readiness(response: Response) -> dict[str, str]:
        if not resolved_runtime.ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "not_ready", "service": "ai-api"}
        return {"status": "ready", "service": "ai-api"}

    app.state.settings = resolved_settings
    app.state.runtime = resolved_runtime
    app.state.rag_service = resolved_rag_service
    app.state.internal_authenticator = internal_authenticator
    app.state.rag_services = rag_services
    app.state.caption_runtime = caption_runtime
    app.state.lecture_note_services = lecture_note_services
    app.state.lecture_note_runtime = lecture_note_runtime
    app.state.replay_rag_service = resolved_replay_service
    app.state.replay_services = replay_services
    return app


async def _shutdown_services(
    *,
    lecture_note_runtime: CaptionRuntime | None,
    caption_runtime: CaptionRuntime | None,
    lecture_note_services: LectureNoteServices | None,
    rag_services: RagServices | None,
    replay_services: ReplayServices | None,
) -> None:
    """consumer를 먼저 멈춘 뒤 application 작업과 외부 client를 순서대로 정리한다."""
    async with AsyncExitStack() as cleanup:
        if rag_services is not None:
            cleanup.push_async_callback(rag_services.close)
        if replay_services is not None:
            cleanup.push_async_callback(replay_services.close)
        if lecture_note_services is not None:
            cleanup.push_async_callback(lecture_note_services.close)
        if caption_runtime is not None:
            cleanup.push_async_callback(caption_runtime.stop)
        if lecture_note_runtime is not None:
            cleanup.push_async_callback(lecture_note_runtime.stop)


def build_internal_authenticator(settings: Settings) -> InternalRequestAuthenticator | None:
    if settings.ai_internal_secret is None:
        return None
    return HmacInternalRequestAuthenticator(
        settings.ai_internal_secret.get_secret_value().encode("utf-8")
    )


def run() -> None:
    settings = load_settings()
    configure_logging("ai-api", settings.log_level)
    rag_services = build_rag_services(settings)
    replay_services = build_replay_rag_services(settings)
    lecture_note_services = build_lecture_note_services(settings)
    internal_authenticator = build_internal_authenticator(settings)
    uvicorn.run(
        create_app(
            settings,
            rag_services=rag_services,
            replay_services=replay_services,
            lecture_note_services=lecture_note_services,
            internal_authenticator=internal_authenticator,
        ),
        host=settings.host,
        port=settings.port,
        log_config=None,
    )


if __name__ == "__main__":
    run()
