from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from stt_lab.nemotron_training import PreparationPolicy, prepare_nemotron_manifests
from stt_lab.training import load_training_pair


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare train/dev-only NeMo manifests for Nemotron ASR fine-tuning."
    )
    parser.add_argument("--train-manifest", type=Path, required=True)
    parser.add_argument("--dev-manifest", type=Path, required=True)
    parser.add_argument("--nemo-model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--target-language", default="ko-KR")
    parser.add_argument("--max-duration-ms", type=int, default=20_000)
    parser.add_argument("--max-token-frame-ratio", type=float, default=1.0)
    return parser


def main() -> None:
    args = build_parser().parse_args()

    pair = load_training_pair(
        args.train_manifest.resolve(),
        args.dev_manifest.resolve(),
    )
    report = prepare_nemotron_manifests(
        pair=pair,
        model_path=args.nemo_model,
        output_dir=args.output_dir.resolve(),
        policy=PreparationPolicy(
            target_language=args.target_language,
            max_duration_ms=args.max_duration_ms,
            max_token_frame_ratio=args.max_token_frame_ratio,
        ),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
