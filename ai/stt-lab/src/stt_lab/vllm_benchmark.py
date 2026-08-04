from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx

from stt_lab.audio import read_pcm16_mono_wav
from stt_lab.contracts import EvaluationClip, load_manifest
from stt_lab.metrics import evaluate_transcript


@dataclass(frozen=True)
class RequestResult:
    clip_id: str
    duration_ms: int
    request_ms: float
    hypothesis: str | None
    metrics: dict[str, float | None] | None
    error: str | None


class VllmTranscriptionClient:
    def __init__(
        self,
        *,
        client: httpx.Client,
        model: str,
    ) -> None:
        self._client = client
        self._model = model

    def models(self) -> tuple[str, ...]:
        response = self._client.get("models")
        response.raise_for_status()
        payload = response.json()
        values = payload.get("data", [])
        return tuple(
            item["id"]
            for item in values
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        )

    def transcribe(self, clip: EvaluationClip) -> RequestResult:
        started = perf_counter()
        duration_ms = 0
        try:
            audio = read_pcm16_mono_wav(clip.audio_path, expected_sha256=clip.sha256)
            duration_ms = audio.duration_ms
            with clip.audio_path.open("rb") as source:
                response = self._client.post(
                    "audio/transcriptions",
                    data={
                        "model": self._model,
                        "language": clip.language.split("-", 1)[0],
                        "response_format": "json",
                        "temperature": "0",
                        "seed": "0",
                    },
                    files={"file": (clip.audio_path.name, source, "audio/wav")},
                )
            response.raise_for_status()
            payload = response.json()
            hypothesis = payload.get("text")
            if not isinstance(hypothesis, str):
                raise TypeError("vLLM response does not contain string field text")
            transcript_metrics = evaluate_transcript(
                clip.reference,
                hypothesis,
                clip.terms,
                training_reference=clip.training_reference,
            )
            request_ms = (perf_counter() - started) * 1_000
            return RequestResult(
                clip_id=clip.clip_id,
                duration_ms=duration_ms,
                request_ms=request_ms,
                hypothesis=hypothesis,
                metrics={
                    "rawCer": transcript_metrics.raw_cer,
                    "normalizedCer": transcript_metrics.normalized_cer,
                    "literalNormalizedCer": transcript_metrics.literal_normalized_cer,
                    "termRecall": transcript_metrics.term_recall,
                    "numberExactMatch": transcript_metrics.number_exact_match,
                },
                error=None,
            )
        except (OSError, TypeError, ValueError, httpx.HTTPError, json.JSONDecodeError) as exc:
            return RequestResult(
                clip_id=clip.clip_id,
                duration_ms=duration_ms,
                request_ms=(perf_counter() - started) * 1_000,
                hypothesis=None,
                metrics=None,
                error=f"{type(exc).__name__}: {str(exc)[:300]}",
            )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    clips = load_manifest(args.manifest)
    selected = tuple(clip for clip in clips if clip.split == args.split)
    if args.limit is not None:
        selected = selected[: args.limit]
    if not selected:
        raise ValueError("no clips matched the requested split and limit")

    concurrency_values = _parse_concurrency(args.concurrency)
    api_key = os.environ.get(args.api_key_env)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    timeout = httpx.Timeout(args.timeout_seconds, connect=args.connect_timeout_seconds)

    with httpx.Client(
        base_url=args.base_url.rstrip("/") + "/",
        headers=headers,
        timeout=timeout,
    ) as http_client:
        client = VllmTranscriptionClient(client=http_client, model=args.model)
        server_models = client.models()
        if args.model not in server_models:
            raise ValueError(f"served model {args.model!r} is not in /models: {server_models}")

        warmup_results = tuple(
            client.transcribe(clip) for clip in selected[: min(args.warmup, len(selected))]
        )
        warmup_errors = [result.error for result in warmup_results if result.error]
        if warmup_errors:
            raise RuntimeError(f"vLLM warmup failed: {warmup_errors[0]}")

        benchmarks = [
            _run_concurrency(
                client,
                selected,
                concurrency=concurrency,
                repeats=args.repeats,
            )
            for concurrency in concurrency_values
        ]

    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(UTC).isoformat(),
        "backend": "vllm",
        "baseUrl": args.base_url,
        "modelId": args.model,
        "pythonVersion": platform.python_version(),
        "manifest": str(args.manifest.resolve()),
        "split": args.split,
        "uniqueClipCount": len(selected),
        "warmupRequests": len(warmup_results),
        "serverModels": server_models,
        "benchmarks": benchmarks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {"modelId": args.model, "benchmarks": [item["summary"] for item in benchmarks]},
            ensure_ascii=False,
        )
    )
    return 1 if any(item["summary"]["failureCount"] for item in benchmarks) else 0


def _run_concurrency(
    client: VllmTranscriptionClient,
    clips: Sequence[EvaluationClip],
    *,
    concurrency: int,
    repeats: int,
) -> dict[str, Any]:
    tasks = tuple(clips) * repeats
    started = perf_counter()
    results: list[RequestResult] = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(client.transcribe, clip) for clip in tasks]
        for future in as_completed(futures):
            results.append(future.result())
    wall_ms = (perf_counter() - started) * 1_000
    successes = [result for result in results if result.error is None]
    failures = [result for result in results if result.error is not None]
    total_audio_ms = sum(result.duration_ms for result in successes)
    request_times = [result.request_ms for result in successes]
    normalized_cer = [
        float(result.metrics["normalizedCer"]) for result in successes if result.metrics is not None
    ]
    literal_normalized_cer = [
        float(result.metrics["literalNormalizedCer"])
        for result in successes
        if result.metrics is not None
    ]

    summary = {
        "concurrency": concurrency,
        "uniqueClipCount": len(clips),
        "requestCount": len(results),
        "successCount": len(successes),
        "failureCount": len(failures),
        "wallMs": wall_ms,
        "audioDurationMs": total_audio_ms,
        "clipsPerMinute": len(successes) * 60_000 / wall_ms if wall_ms else 0.0,
        "aggregateRealTimeFactor": wall_ms / total_audio_ms if total_audio_ms else None,
        "p50RequestMs": _percentile(request_times, 0.50),
        "p95RequestMs": _percentile(request_times, 0.95),
        "p99RequestMs": _percentile(request_times, 0.99),
        "meanNormalizedCer": statistics.fmean(normalized_cer) if normalized_cer else None,
        "meanLiteralNormalizedCer": (
            statistics.fmean(literal_normalized_cer) if literal_normalized_cer else None
        ),
    }
    return {
        "summary": summary,
        "requests": [
            {
                "id": result.clip_id,
                "durationMs": result.duration_ms,
                "requestMs": result.request_ms,
                "hypothesis": result.hypothesis,
                "metrics": result.metrics,
                "error": result.error,
            }
            for result in sorted(results, key=lambda item: (item.clip_id, item.request_ms))
        ],
    }


def _percentile(values: Sequence[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = fraction * (len(ordered) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _parse_concurrency(value: str) -> tuple[int, ...]:
    try:
        parsed = tuple(dict.fromkeys(int(item.strip()) for item in value.split(",")))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("concurrency must be comma-separated integers") from exc
    if not parsed or any(item <= 0 for item in parsed):
        raise argparse.ArgumentTypeError("concurrency values must be positive")
    return parsed


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def _non_negative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be non-negative")
    return parsed


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark a vLLM Whisper STT server")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:18083/v1")
    parser.add_argument("--model", default="liveclass-whisper-large-v3")
    parser.add_argument("--api-key-env", default="STT_LAB_VLLM_API_KEY")
    parser.add_argument("--split", choices=("golden", "dev", "test"), default="dev")
    parser.add_argument("--limit", type=_positive_int)
    parser.add_argument("--concurrency", default="1,4,12")
    parser.add_argument("--repeats", type=_positive_int, default=1)
    parser.add_argument("--warmup", type=_non_negative_int, default=2)
    parser.add_argument("--timeout-seconds", type=_positive_float, default=120.0)
    parser.add_argument("--connect-timeout-seconds", type=_positive_float, default=5.0)
    parser.add_argument("--output", type=Path, default=Path("results/vllm-latest.json"))
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
