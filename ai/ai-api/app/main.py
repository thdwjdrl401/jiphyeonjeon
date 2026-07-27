import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Response, status

from app.config import Settings, load_settings
from app.logging_config import configure_logging
from app.runtime import RuntimeState

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, runtime: RuntimeState | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    resolved_runtime = runtime or RuntimeState()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        resolved_runtime.ready = True
        logger.info("ai-api ready", extra={"event": "service.ready"})
        try:
            yield
        finally:
            resolved_runtime.ready = False
            logger.info("ai-api stopped", extra={"event": "service.stopped"})

    app = FastAPI(title="LiveClass AI API", lifespan=lifespan)

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
    return app


def run() -> None:
    settings = load_settings()
    configure_logging("ai-api", settings.log_level)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,
    )


if __name__ == "__main__":
    run()
