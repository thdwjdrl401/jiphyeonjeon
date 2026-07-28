from __future__ import annotations

import asyncio
import json
import math
import os
import re
import sys
import time
from urllib.parse import urlsplit

import httpx

from app.adapters.remote_bge_embedding import RemoteBgeM3EmbeddingModel
from app.domain import BGE_M3_MODEL


_DEFAULT_RUNTIME_URL = "http://127.0.0.1:18020"
_DEFAULT_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
_IMMUTABLE_REVISION = re.compile(r"^[0-9a-f]{40}$")
_NORMALIZATION_TOLERANCE = 1e-3
_PROBES = (
    "EC2에서 GPU BGE reverse tunnel 통신을 확인합니다.",
    "LiveClass checks a second remote embedding in request order.",
)


def _load_environment() -> tuple[str, str, str, float]:
    runtime_url = os.getenv("AI_WORKER_BGE_RUNTIME_URL", _DEFAULT_RUNTIME_URL)
    token = os.getenv("AI_WORKER_BGE_INTERNAL_TOKEN")
    revision = os.getenv("AI_WORKER_EMBEDDING_REVISION", _DEFAULT_REVISION)
    timeout_text = os.getenv("AI_WORKER_BGE_REQUEST_TIMEOUT_SECONDS", "10")

    parsed = urlsplit(runtime_url)
    if (
        runtime_url != runtime_url.strip()
        or parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("AI_WORKER_BGE_RUNTIME_URL must be an HTTP origin")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("AI_WORKER_BGE_RUNTIME_URL contains an invalid port") from exc

    if token is None or len(token) < 32 or token != token.strip():
        raise ValueError("AI_WORKER_BGE_INTERNAL_TOKEN must contain 32 or more characters")
    if _IMMUTABLE_REVISION.fullmatch(revision) is None:
        raise ValueError("AI_WORKER_EMBEDDING_REVISION must be a full commit revision")
    try:
        timeout_seconds = float(timeout_text)
    except ValueError as exc:
        raise ValueError("AI_WORKER_BGE_REQUEST_TIMEOUT_SECONDS must be numeric") from exc
    if not 0 < timeout_seconds <= 120:
        raise ValueError("AI_WORKER_BGE_REQUEST_TIMEOUT_SECONDS must be between 0 and 120")

    return runtime_url.rstrip("/"), token, revision, timeout_seconds


async def run_probe(
    client: httpx.AsyncClient,
    *,
    internal_token: str,
    model_revision: str,
    timeout_seconds: float,
) -> dict[str, object]:
    try:
        readiness = await client.get("/readyz", timeout=timeout_seconds)
    except httpx.HTTPError as exc:
        raise RuntimeError("BGE runtime readiness request failed") from exc
    if readiness.status_code != httpx.codes.OK:
        raise RuntimeError(f"BGE runtime is not ready (status={readiness.status_code})")
    try:
        readiness_payload = readiness.json()
    except ValueError as exc:
        raise RuntimeError("BGE runtime readiness response is not JSON") from exc
    if readiness_payload != {"status": "ready", "service": "bge-runtime"}:
        raise RuntimeError("BGE runtime readiness response does not match the contract")

    adapter = RemoteBgeM3EmbeddingModel(
        client,
        internal_token=internal_token,
        model_revision=model_revision,
        request_timeout_seconds=timeout_seconds,
    )
    started = time.perf_counter()
    vectors = await adapter.embed(_PROBES)
    embedding_ms = (time.perf_counter() - started) * 1_000

    norms = [math.sqrt(math.fsum(value * value for value in vector)) for vector in vectors]
    max_norm_error = max(abs(norm - 1.0) for norm in norms)
    if max_norm_error > _NORMALIZATION_TOLERANCE:
        raise RuntimeError("BGE runtime returned vectors outside the normalization tolerance")

    return {
        "status": "ok",
        "runtimeUrl": str(client.base_url).rstrip("/"),
        "model": BGE_M3_MODEL,
        "revision": model_revision,
        "count": len(vectors),
        "dimensions": sorted({len(vector) for vector in vectors}),
        "maxNormError": round(max_norm_error, 8),
        "embeddingMs": round(embedding_ms, 1),
    }


async def _run() -> dict[str, object]:
    runtime_url, token, revision, timeout_seconds = _load_environment()
    async with httpx.AsyncClient(base_url=runtime_url) as client:
        return await run_probe(
            client,
            internal_token=token,
            model_revision=revision,
            timeout_seconds=timeout_seconds,
        )


def main() -> None:
    try:
        result = asyncio.run(_run())
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "error",
                    "errorType": type(exc).__name__,
                    "message": str(exc),
                },
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
