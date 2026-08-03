from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import platform
import re
import statistics
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from app.audio.segmentation import VadSegmenter
from app.stt.providers.segmented import SpeechSegmenter

from stt_lab.audio import read_pcm16_mono_wav
from stt_lab.contracts import EvaluationClip, load_manifest
from stt_lab.metrics import evaluate_transcript
from stt_lab.replay import (
    EngineEventObservation,
    RecordingSegmenter,
    ReplayExecution,
    ReplayMode,
    build_audio_replay,
    event_to_dict,
    run_engine_replay,
)
from stt_lab.replay_backends import ReplayBackendSlot, build_backend_slot
from stt_lab.reporting import write_replay_artifacts

_SAFE_CANDIDATE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SlotBuilder = Callable[[str, str, str, str, str], ReplayBackendSlot]
SegmenterFactory = Callable[[], SpeechSegmenter]


@dataclass(frozen=True)
class CandidateSpec:
    name: str
    backend: str
    model_id: str


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.cuda_visible_devices != "0":
        raise ValueError("this host permits STT experiments on GPU 0 only")
    if args.split == "test" and not args.allow_test:
        raise ValueError("test evaluation requires explicit --allow-test")

    candidates = tuple(_parse_candidate(value) for value in args.candidate)
    _require_unique_candidate_names(candidates)
    clips = tuple(clip for clip in load_manifest(args.manifest) if clip.split == args.split)
    if args.limit is not None:
        clips = clips[: args.limit]
    if not clips:
        raise ValueError("no clips matched the requested split and limit")
    if any(clip.language != args.language for clip in clips):
        raise ValueError("all selected clips must match --language")

    os.environ["CUDA_VISIBLE_DEVICES"] = args.cuda_visible_devices
    report = asyncio.run(
        evaluate_candidates(
            candidates,
            clips,
            mode=args.mode,
            workers=args.workers,
            language=args.language,
            device=args.device,
            precision=args.precision,
        )
    )
    report.update(
        {
            "schemaVersion": 1,
            "createdAt": datetime.now(UTC).isoformat(),
            "codeSha": _git_sha(),
            "manifest": str(args.manifest.resolve()),
            "manifestSha256": _sha256(args.manifest),
            "split": args.split,
            "cudaVisibleDevices": args.cuda_visible_devices,
            "pythonVersion": platform.python_version(),
        }
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    artifact_dir = args.artifact_dir or args.output.parent / f"{args.output.stem}-artifacts"
    write_replay_artifacts(report, artifact_dir)
    print(
        json.dumps(
            {
                "mode": args.mode,
                "workers": args.workers,
                "artifactDir": str(artifact_dir.resolve()),
                "candidates": {
                    candidate["name"]: candidate["summary"] for candidate in report["candidates"]
                },
            },
            ensure_ascii=False,
        )
    )
    return 0


async def evaluate_candidates(
    candidates: Sequence[CandidateSpec],
    clips: Sequence[EvaluationClip],
    *,
    mode: ReplayMode,
    workers: int,
    language: str,
    device: str,
    precision: str,
    slot_builder: SlotBuilder | None = None,
    segmenter_factory: SegmenterFactory = VadSegmenter,
) -> dict[str, Any]:
    if not candidates:
        raise ValueError("at least one candidate is required")
    if not clips:
        raise ValueError("at least one clip is required")
    if workers <= 0 or workers > 12:
        raise ValueError("workers must be between 1 and 12")

    builder = slot_builder or _default_slot_builder
    candidate_reports: list[dict[str, Any]] = []
    expected_plans: dict[str, str] | None = None
    common_segment_plans: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        candidate_report = await _evaluate_candidate(
            candidate,
            clips,
            mode=mode,
            workers=workers,
            language=language,
            device=device,
            precision=precision,
            slot_builder=builder,
            segmenter_factory=segmenter_factory,
        )
        plan_hashes = {clip["id"]: clip["segmentPlanSha256"] for clip in candidate_report["clips"]}
        if expected_plans is None:
            expected_plans = plan_hashes
            common_segment_plans = {
                clip["id"]: clip["segmentPlan"] for clip in candidate_report["clips"]
            }
        elif plan_hashes != expected_plans:
            raise RuntimeError(
                f"candidate {candidate.name!r} produced a different production VAD segment plan"
            )
        candidate_reports.append(candidate_report)

    return {
        "mode": mode,
        "workers": workers,
        "vad": {
            "implementation": "app.audio.segmentation.VadSegmenter",
            "sampleRate": 16_000,
            "frameMs": 20,
            "padMs": 200,
            "minSpeechMs": 300,
            "maxSpeechMs": 8_000,
            "silenceCloseMs": 500,
        },
        "segmentPlans": common_segment_plans,
        "candidates": candidate_reports,
    }


async def _evaluate_candidate(
    candidate: CandidateSpec,
    clips: Sequence[EvaluationClip],
    *,
    mode: ReplayMode,
    workers: int,
    language: str,
    device: str,
    precision: str,
    slot_builder: SlotBuilder,
    segmenter_factory: SegmenterFactory,
) -> dict[str, Any]:
    slot_count = min(workers, len(clips))
    slots = [
        slot_builder(candidate.backend, candidate.model_id, language, device, precision)
        for _ in range(slot_count)
    ]
    loaded_slots: list[ReplayBackendSlot] = []
    load_started = perf_counter()
    try:
        for slot in slots:
            await asyncio.to_thread(slot.load)
            loaded_slots.append(slot)
        load_ms = (perf_counter() - load_started) * 1_000
        _reset_cuda_peak()
        indexed_results: list[tuple[int, dict[str, Any]]] = []

        async def evaluate_slot(slot_index: int, slot: ReplayBackendSlot) -> None:
            for clip_index in range(slot_index, len(clips), slot_count):
                result = await _evaluate_clip(
                    slot,
                    clips[clip_index],
                    mode=mode,
                    stream_id=f"{candidate.name}:{clips[clip_index].clip_id}",
                    segmenter_factory=segmenter_factory,
                )
                indexed_results.append((clip_index, result))

        async with asyncio.TaskGroup() as task_group:
            for slot_index, slot in enumerate(slots):
                task_group.create_task(
                    evaluate_slot(slot_index, slot),
                    name=f"stt-lab-slot:{candidate.name}:{slot_index}",
                )
        clip_results = [result for _, result in sorted(indexed_results)]
        metadata = slots[0].metadata
        return {
            "name": candidate.name,
            "backend": metadata.backend,
            "modelId": metadata.model_id,
            "precision": metadata.precision,
            "outputMode": metadata.output_mode,
            "loadMs": load_ms,
            "workerSlots": slot_count,
            "peakCudaAllocatedBytes": _cuda_peak_allocated(),
            "peakCudaReservedBytes": _cuda_peak_reserved(),
            "summary": _summarize(clip_results),
            "clips": clip_results,
        }
    finally:
        for slot in reversed(loaded_slots):
            await asyncio.to_thread(slot.close)


async def _evaluate_clip(
    slot: ReplayBackendSlot,
    clip: EvaluationClip,
    *,
    mode: ReplayMode,
    stream_id: str,
    segmenter_factory: SegmenterFactory,
) -> dict[str, Any]:
    audio = read_pcm16_mono_wav(clip.audio_path, expected_sha256=clip.sha256)
    replay = build_audio_replay(audio)
    recorder = RecordingSegmenter(segmenter_factory())
    engine = slot.create_engine(recorder)
    execution = await run_engine_replay(
        engine,
        recorder,
        replay,
        stream_id=stream_id,
        language=clip.language,
        mode=mode,
    )
    transcript_metrics = evaluate_transcript(clip.reference, execution.transcript, clip.terms)
    segments = _segment_results(execution)
    return {
        "id": clip.clip_id,
        "split": clip.split,
        "speakerId": clip.speaker_id,
        "audioSha256": audio.sha256,
        "sourceDurationMs": execution.source_duration_ms,
        "replayDurationMs": execution.replay_duration_ms,
        "paddedSamples": execution.padded_samples,
        "reference": clip.reference,
        "hypothesis": execution.transcript,
        "rawCer": transcript_metrics.raw_cer,
        "normalizedCer": transcript_metrics.normalized_cer,
        "termRecall": transcript_metrics.term_recall,
        "numberExactMatch": transcript_metrics.number_exact_match,
        "wallMs": execution.wall_ms,
        "realTimeFactor": execution.wall_ms / execution.source_duration_ms,
        "segmentPlanSha256": execution.segment_plan_sha256,
        "segmentPlan": [
            {**entry.canonical(), "readyWallMs": entry.ready_wall_ms}
            for entry in execution.segment_plan
        ],
        "segments": segments,
        "events": [event_to_dict(event) for event in execution.events],
    }


def _segment_results(execution: ReplayExecution) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for plan in execution.segment_plan:
        final = next(
            (
                event
                for event in execution.events
                if event.kind == "segmentFinal"
                and event.start_ms == plan.start_ms
                and event.end_ms == plan.end_ms
            ),
            None,
        )
        first_delta = next(
            (
                event
                for event in execution.events
                if event.kind == "textDelta" and event.stream_elapsed_ms == plan.end_ms
            ),
            None,
        )
        first_output = first_delta or final
        results.append(
            {
                **plan.canonical(),
                "readyWallMs": plan.ready_wall_ms,
                "text": final.text if final is not None else None,
                "firstOutputWallMs": first_output.wall_ms if first_output is not None else None,
                "finalWallMs": final.wall_ms if final is not None else None,
                "readyToFirstOutputMs": _difference(first_output, plan.ready_wall_ms),
                "readyToFinalMs": _difference(final, plan.ready_wall_ms),
                "speechStartToFirstOutputMs": (
                    _difference(first_output, float(plan.start_ms))
                    if execution.mode == "paced"
                    else None
                ),
                "speechEndToFinalMs": (
                    _difference(final, float(plan.end_ms)) if execution.mode == "paced" else None
                ),
            }
        )
    return results


def _difference(event: EngineEventObservation | None, baseline_ms: float) -> float | None:
    return event.wall_ms - baseline_ms if event is not None else None


def _summarize(clips: Sequence[dict[str, Any]]) -> dict[str, Any]:
    final_latencies = [
        segment["speechEndToFinalMs"]
        for clip in clips
        for segment in clip["segments"]
        if segment["speechEndToFinalMs"] is not None
    ]
    return {
        "clipCount": len(clips),
        "segmentCount": sum(len(clip["segments"]) for clip in clips),
        "sourceDurationMs": sum(clip["sourceDurationMs"] for clip in clips),
        "meanNormalizedCer": statistics.fmean(clip["normalizedCer"] for clip in clips),
        "meanRealTimeFactor": statistics.fmean(clip["realTimeFactor"] for clip in clips),
        "p50SpeechEndToFinalMs": _percentile(final_latencies, 0.50),
        "p95SpeechEndToFinalMs": _percentile(final_latencies, 0.95),
        "missingFinalCount": sum(
            segment["finalWallMs"] is None for clip in clips for segment in clip["segments"]
        ),
        "warningCount": sum(
            event["kind"] == "warning" for clip in clips for event in clip["events"]
        ),
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


def _parse_candidate(value: str) -> CandidateSpec:
    try:
        name, definition = value.split("=", 1)
        backend, model_id = definition.split("@", 1)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("candidate must use NAME=BACKEND@MODEL format") from exc
    if not _SAFE_CANDIDATE_NAME.fullmatch(name):
        raise argparse.ArgumentTypeError("candidate name is not safe")
    if backend not in {"nemotron", "whisper"}:
        raise argparse.ArgumentTypeError("candidate backend must be nemotron or whisper")
    if not model_id.strip():
        raise argparse.ArgumentTypeError("candidate model must not be blank")
    return CandidateSpec(name=name, backend=backend, model_id=model_id)


def _require_unique_candidate_names(candidates: Sequence[CandidateSpec]) -> None:
    names = [candidate.name for candidate in candidates]
    if len(set(names)) != len(names):
        raise ValueError("candidate names must be unique")


def _default_slot_builder(
    backend: str,
    model_id: str,
    language: str,
    device: str,
    precision: str,
) -> ReplayBackendSlot:
    return build_backend_slot(
        backend,
        model_id,
        language=language,
        device=device,
        precision=precision,
    )


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git_sha() -> str | None:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


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
    parser = argparse.ArgumentParser(
        description="Compare STT candidates through the production VAD replay pipeline"
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--candidate",
        action="append",
        required=True,
        help="repeat NAME=BACKEND@MODEL; backend is nemotron or whisper",
    )
    parser.add_argument("--mode", choices=("accuracy", "paced"), default="accuracy")
    parser.add_argument("--workers", type=_positive_int, default=1)
    parser.add_argument("--language", default="ko-KR")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument(
        "--precision",
        choices=("bfloat16", "float16", "float32"),
        default="bfloat16",
    )
    parser.add_argument("--cuda-visible-devices", default="0")
    parser.add_argument("--split", choices=("golden", "dev", "test"), default="dev")
    parser.add_argument("--allow-test", action="store_true")
    parser.add_argument("--limit", type=_positive_int)
    parser.add_argument("--output", type=Path, default=Path("results/replay-latest.json"))
    parser.add_argument("--artifact-dir", type=Path)
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
