from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import time

from app.embedding import (
    BGE_M3_MODEL,
    BGE_M3_REVISION,
    BgeM3EmbeddingModel,
    parse_cuda_device,
)

_PROBES = [
    "실시간 강의 자막 검색을 위한 짧은 문장입니다.",
    "LiveClass validates a second embedding in request order.",
]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an opt-in BGE-M3 CUDA smoke check")
    parser.add_argument("--device", default="cuda")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Require the pinned model revision to exist in the local Hugging Face cache",
    )
    return parser.parse_args()


async def _run(device: str) -> dict[str, object]:
    import torch

    device_index = parse_cuda_device(device)
    torch.cuda.set_device(device_index)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    model = BgeM3EmbeddingModel(
        BGE_M3_MODEL,
        BGE_M3_REVISION,
        device=device,
        batch_size=2,
    )

    started = time.perf_counter()
    cold_vectors = await model.embed(_PROBES)
    torch.cuda.synchronize()
    cold_ms = (time.perf_counter() - started) * 1_000

    started = time.perf_counter()
    warm_vectors = await model.embed(_PROBES)
    torch.cuda.synchronize()
    warm_ms = (time.perf_counter() - started) * 1_000

    norms = [math.sqrt(math.fsum(value * value for value in vector)) for vector in warm_vectors]
    repeat_delta = max(
        abs(cold - warm)
        for cold_vector, warm_vector in zip(cold_vectors, warm_vectors, strict=True)
        for cold, warm in zip(cold_vector, warm_vector, strict=True)
    )
    return {
        "model": model.model,
        "revision": model.revision,
        "device": device,
        "count": len(warm_vectors),
        "dimensions": sorted({len(vector) for vector in warm_vectors}),
        "finite": all(math.isfinite(value) for vector in warm_vectors for value in vector),
        "maxNormError": max(abs(norm - 1.0) for norm in norms),
        "maxRepeatDelta": repeat_delta,
        "coldMs": round(cold_ms, 1),
        "warmMs": round(warm_ms, 1),
        "peakAllocatedMiB": round(torch.cuda.max_memory_allocated() / 2**20, 1),
        "peakReservedMiB": round(torch.cuda.max_memory_reserved() / 2**20, 1),
    }


def main() -> None:
    args = _parse_args()
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    print(json.dumps(asyncio.run(_run(args.device)), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
