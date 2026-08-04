from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from stt_lab.qwen_training import export_qwen_training_data


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    result = export_qwen_training_data(
        args.source_manifest,
        args.protected_manifest,
        args.output_dir,
        eval_ratio=args.eval_ratio,
        seed=args.seed,
        verify_audio_content=args.verify_audio_content,
    )
    print(
        json.dumps(
            {
                "outputDir": str(result.output_dir),
                "trainFile": str(result.train_file),
                "evalFile": str(result.eval_file),
                "provenanceFile": str(result.provenance_file),
                "trainClipCount": result.train_count,
                "evalClipCount": result.eval_count,
                "trainDurationMs": result.train_duration_ms,
                "evalDurationMs": result.eval_duration_ms,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Export Qwen3-ASR SFT JSONL from train only while protecting benchmark manifests"
        )
    )
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument(
        "--protected-manifest",
        type=Path,
        action="append",
        required=True,
        help="repeat for dev benchmark, dev, test, and golden manifests",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--eval-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=37)
    parser.add_argument(
        "--verify-audio-content",
        action="store_true",
        help="hash every source/protected WAV in addition to metadata leakage checks",
    )
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
