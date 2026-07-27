from fastapi import FastAPI, Response, status

from app.runtime import WorkerState


def create_management_app(state: WorkerState) -> FastAPI:
    app = FastAPI(title="LiveClass AI Worker Management")

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-worker"}

    @app.get("/readyz")
    async def readiness(response: Response) -> dict[str, str]:
        if not state.ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "not_ready", "service": "ai-worker"}
        return {"status": "ready", "service": "ai-worker"}

    return app
