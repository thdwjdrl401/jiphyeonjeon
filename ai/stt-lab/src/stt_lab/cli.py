from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from stt_lab.audio import read_pcm16_mono_wav
from stt_lab.contracts import EvaluationClip, load_manifest
from stt_lab.metrics import evaluate_transcript
from stt_lab.runners import build_runner


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    clips = load_manifest(args.manifest, require_audio=not args.validate_only)
    selected = tuple(clip for clip in clips if args.split == "all" or clip.split == args.split)
    if args.limit is not None:
        selected = selected[: args.limit]
    if not selected:
        raise ValueError("no clips matched the requested split and limit")
    if args.validate_only:
        print(json.dumps({"status": "valid", "clips": len(selected)}, ensure_ascii=False))
        return 0
    if not args.model:
        raise ValueError("--model is required for a GPU benchmark")

    os.environ["CUDA_VISIBLE_DEVICES"] = args.cuda_visible_devices
    runner = build_runner(
        args.backend,
        args.model,
        device=args.device,
        precision=args.precision,
    )
    load_started = perf_counter()
    runner.load()
    load_ms = (perf_counter() - load_started) * 1_000
    results: list[dict[str, Any]] = []
    try:
        for clip in selected:
            results.append(_evaluate_clip(runner, clip))
    finally:
        runner.close()

    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(UTC).isoformat(),
        "backend": args.backend,
        "modelId": runner.model_id,
        "precision": runner.precision,
        "cudaVisibleDevices": args.cuda_visible_devices,
        "pythonVersion": platform.python_version(),
        "loadMs": load_ms,
        "summary": _summarize(results),
        "clips": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 0


def _evaluate_clip(runner: Any, clip: EvaluationClip) -> dict[str, Any]:
    audio = read_pcm16_mono_wav(clip.audio_path, expected_sha256=clip.sha256)
    _reset_cuda_peak()
    transcription = runner.transcribe(audio, clip.language)
    metrics = evaluate_transcript(clip.reference, transcription.text, clip.terms)
    return {
        "id": clip.clip_id,
        "split": clip.split,
        "speakerId": clip.speaker_id,
        "audioSha256": audio.sha256,
        "durationMs": audio.duration_ms,
        "reference": clip.reference,
        "hypothesis": transcription.text,
        "rawCer": metrics.raw_cer,
        "normalizedCer": metrics.normalized_cer,
        "termRecall": metrics.term_recall,
        "numberExactMatch": metrics.number_exact_match,
        "firstDeltaMs": transcription.first_delta_ms,
        "totalMs": transcription.total_ms,
        "realTimeFactor": transcription.total_ms / audio.duration_ms,
        "peakCudaAllocatedBytes": _cuda_peak_allocated(),
        "peakCudaReservedBytes": _cuda_peak_reserved(),
    }


def _summarize(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {
        "clipCount": len(results),
        "durationMs": sum(result["durationMs"] for result in results),
        "meanNormalizedCer": statistics.fmean(result["normalizedCer"] for result in results),
        "p50TotalMs": _percentile([result["totalMs"] for result in results], 0.50),
        "p95TotalMs": _percentile([result["totalMs"] for result in results], 0.95),
        "meanRealTimeFactor": statistics.fmean(result["realTimeFactor"] for result in results),
        "peakCudaAllocatedBytes": max(result["peakCudaAllocatedBytes"] for result in results),
        "peakCudaReservedBytes": max(result["peakCudaReservedBytes"] for result in results),
    }


def _percentile(values: Sequence[float], fraction: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = fraction * (len(ordered) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _reset_cuda_peak() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
    except ImportError:
        return


def _cuda_peak_allocated() -> int:
    try:
        import torch

        return torch.cuda.max_memory_allocated() if torch.cuda.is_available() else 0
    except ImportError:
        return 0


def _cuda_peak_reserved() -> int:
    try:
        import torch

        return torch.cuda.max_memory_reserved() if torch.cuda.is_available() else 0
    except ImportError:
        return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark LiveClass STT candidates")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--backend", choices=("nemotron", "whisper"), default="nemotron")
    parser.add_argument("--model")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument(
        "--precision",
        choices=("bfloat16", "float16", "float32"),
        default="bfloat16",
    )
    parser.add_argument("--cuda-visible-devices", default="0")
    parser.add_argument("--split", choices=("all", "golden", "dev", "test"), default="all")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--output", type=Path, default=Path("results/latest.json"))
    parser.add_argument("--validate-only", action="store_true")
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
