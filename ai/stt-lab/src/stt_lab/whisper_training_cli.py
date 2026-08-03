from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

from stt_lab.training import TrainingArtifactWriter, deterministic_batches, load_training_pair
from stt_lab.whisper_training import (
    WhisperDryRunRequest,
    resume_transformers_whisper,
    run_whisper_dry_run,
)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.cuda_visible_devices != "0":
        raise ValueError("this host permits Whisper training on GPU 0 only")
    os.environ["CUDA_VISIBLE_DEVICES"] = args.cuda_visible_devices
    if args.command == "run":
        return _run(args)
    if args.command == "resume":
        return _resume(args)
    raise RuntimeError(f"unsupported command: {args.command}")


def _run(args: argparse.Namespace) -> int:
    datasets = load_training_pair(args.train_manifest, args.dev_manifest)
    writer = TrainingArtifactWriter(args.artifact_root, args.run_id)
    request = _request(args)

    def resume_in_new_process(examples: tuple[object, ...]) -> float:
        del examples
        result_path = writer.run_dir / "resume-result.json"
        command = [
            sys.executable,
            "-m",
            "stt_lab.whisper_training_cli",
            "resume",
            "--train-manifest",
            str(args.train_manifest),
            "--dev-manifest",
            str(args.dev_manifest),
            "--artifact-root",
            str(args.artifact_root),
            "--run-id",
            args.run_id,
            "--model",
            args.model,
            "--device",
            args.device,
            "--precision",
            args.precision,
            "--batch-size",
            str(args.batch_size),
            "--learning-rate",
            str(args.learning_rate),
            "--seed",
            str(args.seed),
            "--max-audio-seconds",
            str(args.max_audio_seconds),
            "--max-text-tokens",
            str(args.max_text_tokens),
            "--cuda-visible-devices",
            args.cuda_visible_devices,
            "--result",
            str(result_path),
        ]
        subprocess.run(command, check=True)
        result = json.loads(result_path.read_text(encoding="utf-8"))
        return float(result["resumedTrainLoss"])

    result = run_whisper_dry_run(
        datasets,
        request,
        writer,
        resume_runner=resume_in_new_process,
    )
    replay_output = writer.run_dir / "evaluation" / "golden-replay.json"
    replay_artifacts = writer.run_dir / "evaluation" / "golden-replay-artifacts"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "stt_lab.replay_cli",
            "--manifest",
            str(args.golden_manifest),
            "--candidate",
            f"whisper-dry-run=whisper@{writer.checkpoint_dir}",
            "--mode",
            "accuracy",
            "--workers",
            "1",
            "--precision",
            args.precision,
            "--cuda-visible-devices",
            args.cuda_visible_devices,
            "--split",
            "golden",
            "--output",
            str(replay_output),
            "--artifact-dir",
            str(replay_artifacts),
        ],
        check=True,
    )
    final = {
        "status": "GOLDEN_REPLAY_VERIFIED",
        "completedSteps": 2,
        "initialTrainLoss": result.first_train_loss,
        "devLoss": result.dev_loss,
        "resumedTrainLoss": result.resumed_train_loss,
        "goldenReplay": str(replay_output),
    }
    writer.write_trainer_state(final)
    print(json.dumps(final, ensure_ascii=False))
    return 0


def _resume(args: argparse.Namespace) -> int:
    datasets = load_training_pair(args.train_manifest, args.dev_manifest)
    batches = tuple(
        deterministic_batches(
            datasets.train.examples,
            batch_size=args.batch_size,
            seed=args.seed,
        )
    )
    if len(batches) < 2 or len(batches[1]) != args.batch_size:
        raise ValueError("resume requires a second complete train batch")
    writer = TrainingArtifactWriter(args.artifact_root, args.run_id)
    loss = resume_transformers_whisper(_request(args), writer, batches[1])
    result = {"status": "RESUME_VERIFIED", "resumedTrainLoss": loss}
    args.result.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


def _request(args: argparse.Namespace) -> WhisperDryRunRequest:
    return WhisperDryRunRequest(
        model_id=args.model,
        device=args.device,
        precision=args.precision,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        seed=args.seed,
        max_audio_seconds=args.max_audio_seconds,
        max_text_tokens=args.max_text_tokens,
    )


def _add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--train-manifest", type=Path, required=True)
    parser.add_argument("--dev-manifest", type=Path, required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument(
        "--precision",
        choices=("bfloat16", "float16", "float32"),
        default="bfloat16",
    )
    parser.add_argument("--batch-size", type=_positive_int, default=2)
    parser.add_argument("--learning-rate", type=_positive_float, default=1e-5)
    parser.add_argument("--seed", type=int, default=20260803)
    parser.add_argument("--max-audio-seconds", type=_positive_float, default=30.0)
    parser.add_argument("--max-text-tokens", type=_positive_int, default=448)
    parser.add_argument("--cuda-visible-devices", default="0")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run Whisper one-step/save/new-process-resume/product-VAD replay"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    _add_common_arguments(run)
    run.add_argument("--golden-manifest", type=Path, required=True)
    resume = commands.add_parser("resume")
    _add_common_arguments(resume)
    resume.add_argument("--result", type=Path, required=True)
    return parser


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())
