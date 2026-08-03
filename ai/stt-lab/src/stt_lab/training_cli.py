from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from stt_lab.training import dataset_pair_summary, load_training_pair


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    pair = load_training_pair(args.train_manifest, args.dev_manifest)
    report = {"schemaVersion": 1, "status": "ready", **dataset_pair_summary(pair)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate train/dev manifests before an opt-in STT training run"
    )
    parser.add_argument("--train-manifest", type=Path, required=True)
    parser.add_argument("--dev-manifest", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("results/training-preflight.json"),
    )
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
