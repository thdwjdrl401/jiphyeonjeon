from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from stt_lab.contracts import EvaluationClip, load_manifest
from stt_lab.training import TrainingExample, load_training_dataset

_QWEN_KOREAN_PREFIX = "language Korean<asr_text>"


@dataclass(frozen=True)
class QwenTrainingExport:
    output_dir: Path
    train_file: Path
    eval_file: Path
    provenance_file: Path
    train_count: int
    eval_count: int
    train_duration_ms: int
    eval_duration_ms: int


@dataclass(frozen=True)
class _Component:
    examples: tuple[TrainingExample, ...]
    duration_ms: int
    key: str


def export_qwen_training_data(
    source_manifest: Path,
    protected_manifests: Sequence[Path],
    output_dir: Path,
    *,
    eval_ratio: float = 0.1,
    seed: int = 37,
    verify_audio_content: bool = False,
) -> QwenTrainingExport:
    if not 0.01 <= eval_ratio <= 0.5:
        raise ValueError("eval_ratio must be between 0.01 and 0.5")
    if not protected_manifests:
        raise ValueError("at least one protected manifest is required")

    source = load_training_dataset(source_manifest, expected_split="train")
    protected = tuple(clip for manifest in protected_manifests for clip in load_manifest(manifest))
    _validate_protected_disjoint(
        source.examples,
        protected,
        verify_audio_content=verify_audio_content,
    )

    components = _connected_components(source.examples, seed=seed)
    eval_components = _select_eval_components(components, eval_ratio=eval_ratio)
    eval_keys = {component.key for component in eval_components}
    eval_examples = tuple(
        example
        for component in components
        if component.key in eval_keys
        for example in component.examples
    )
    train_examples = tuple(
        example
        for component in components
        if component.key not in eval_keys
        for example in component.examples
    )
    _validate_partition(train_examples, eval_examples)

    resolved_output = output_dir.resolve()
    resolved_output.mkdir(parents=True, exist_ok=False)
    train_file = resolved_output / "train.jsonl"
    eval_file = resolved_output / "eval.jsonl"
    provenance_file = resolved_output / "provenance.json"
    _write_qwen_jsonl(train_file, train_examples, seed=seed)
    _write_qwen_jsonl(eval_file, eval_examples, seed=seed)

    provenance = {
        "formatVersion": 1,
        "targetFormat": "Qwen3-ASR supervised fine-tuning JSONL",
        "targetPrefix": _QWEN_KOREAN_PREFIX,
        "targetContainsEos": False,
        "eosPolicy": "the official Qwen collator appends tokenizer.eos_token",
        "partitionPolicy": "speaker-lecture-connected-component",
        "seed": seed,
        "requestedEvalRatio": eval_ratio,
        "audioContentVerified": verify_audio_content,
        "source": _manifest_summary(source_manifest),
        "protected": [_manifest_summary(path) for path in protected_manifests],
        "train": _split_summary(train_examples, train_file),
        "eval": _split_summary(eval_examples, eval_file),
        "speakerIntersection": 0,
        "lectureIntersection": 0,
        "protectedIntersections": {
            "clipId": 0,
            "audioPath": 0,
            "speakerId": 0,
            "lectureId": 0,
            "audioContent": 0 if verify_audio_content else None,
        },
    }
    provenance_file.write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return QwenTrainingExport(
        output_dir=resolved_output,
        train_file=train_file,
        eval_file=eval_file,
        provenance_file=provenance_file,
        train_count=len(train_examples),
        eval_count=len(eval_examples),
        train_duration_ms=sum(item.duration_ms for item in train_examples),
        eval_duration_ms=sum(item.duration_ms for item in eval_examples),
    )


def qwen_target(transcript: str, language: str) -> str:
    if language not in {"ko", "ko-KR"}:
        raise ValueError(f"unsupported Qwen training language: {language}")
    normalized = transcript.strip()
    if not normalized:
        raise ValueError("Qwen training transcript must not be blank")
    if normalized.startswith("language ") and "<asr_text>" in normalized:
        raise ValueError("Qwen training transcript already contains a language prefix")
    return _QWEN_KOREAN_PREFIX + normalized


def _connected_components(
    examples: Sequence[TrainingExample],
    *,
    seed: int,
) -> tuple[_Component, ...]:
    parent = list(range(len(examples)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    first_speaker: dict[str, int] = {}
    first_lecture: dict[str, int] = {}
    for index, example in enumerate(examples):
        previous = first_speaker.get(example.speaker_id)
        if previous is not None:
            union(index, previous)
        else:
            first_speaker[example.speaker_id] = index
        previous = first_lecture.get(example.lecture_id)
        if previous is not None:
            union(index, previous)
        else:
            first_lecture[example.lecture_id] = index

    grouped: dict[int, list[TrainingExample]] = defaultdict(list)
    for index, example in enumerate(examples):
        grouped[find(index)].append(example)
    components = []
    for values in grouped.values():
        ordered = tuple(sorted(values, key=lambda item: item.example_id))
        identity = "\n".join(item.example_id for item in ordered)
        key = hashlib.sha256(f"{seed}:{identity}".encode()).hexdigest()
        components.append(_Component(ordered, sum(item.duration_ms for item in ordered), key))
    return tuple(sorted(components, key=lambda item: (-item.duration_ms, item.key)))


def _select_eval_components(
    components: Sequence[_Component],
    *,
    eval_ratio: float,
) -> tuple[_Component, ...]:
    if len(components) < 2:
        raise ValueError("at least two speaker-lecture components are required")
    target_ms = round(sum(component.duration_ms for component in components) * eval_ratio)
    selected: list[_Component] = []
    selected_ms = 0
    for component in components:
        if abs(target_ms - (selected_ms + component.duration_ms)) < abs(target_ms - selected_ms):
            selected.append(component)
            selected_ms += component.duration_ms
    if not selected:
        selected = [min(components, key=lambda item: (item.duration_ms, item.key))]
    if len(selected) == len(components):
        selected.remove(max(selected, key=lambda item: (item.duration_ms, item.key)))
    return tuple(selected)


def _validate_partition(
    train_examples: Sequence[TrainingExample],
    eval_examples: Sequence[TrainingExample],
) -> None:
    if not train_examples or not eval_examples:
        raise ValueError("Qwen train/eval partition must keep both splits non-empty")
    fields = (
        ("clip", lambda item: item.example_id),
        ("speaker", lambda item: item.speaker_id),
        ("lecture", lambda item: item.lecture_id),
        ("audio path", lambda item: str(item.audio_path.resolve())),
    )
    for label, value in fields:
        overlap = {value(item) for item in train_examples} & {value(item) for item in eval_examples}
        if overlap:
            raise ValueError(f"Qwen train/eval {label} leakage: {sorted(overlap)[:10]}")


def _validate_protected_disjoint(
    source: Sequence[TrainingExample],
    protected: Sequence[EvaluationClip],
    *,
    verify_audio_content: bool,
) -> None:
    fields: tuple[tuple[str, Iterable[str], Iterable[str]], ...] = (
        ("clip", (item.example_id for item in source), (item.clip_id for item in protected)),
        (
            "audio path",
            (str(item.audio_path.resolve()) for item in source),
            (str(item.audio_path.resolve()) for item in protected),
        ),
        ("speaker", (item.speaker_id for item in source), (item.speaker_id for item in protected)),
        (
            "lecture",
            (item.lecture_id for item in source),
            (item.lecture_id for item in protected if item.lecture_id is not None),
        ),
    )
    for label, source_values, protected_values in fields:
        overlap = set(source_values) & set(protected_values)
        if overlap:
            raise ValueError(f"training/protected {label} leakage: {sorted(overlap)[:10]}")

    if verify_audio_content:
        cache: dict[Path, str] = {}
        source_hashes = {_audio_sha256(item.audio_path, cache) for item in source}
        protected_hashes = {_audio_sha256(item.audio_path, cache) for item in protected}
        if overlap := source_hashes & protected_hashes:
            raise ValueError(f"training/protected audio content leakage: {sorted(overlap)[:10]}")


def _audio_sha256(path: Path, cache: dict[Path, str]) -> str:
    resolved = path.resolve()
    if resolved not in cache:
        digest = hashlib.sha256()
        with resolved.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        cache[resolved] = digest.hexdigest()
    return cache[resolved]


def _write_qwen_jsonl(path: Path, examples: Sequence[TrainingExample], *, seed: int) -> None:
    ordered = sorted(
        examples,
        key=lambda item: hashlib.sha256(f"{seed}:{item.example_id}".encode()).hexdigest(),
    )
    with path.open("x", encoding="utf-8") as target:
        for example in ordered:
            record = {
                "audio": str(example.audio_path.resolve()),
                "text": qwen_target(example.transcript, example.language),
            }
            target.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def _manifest_summary(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    return {
        "path": str(resolved),
        "sha256": hashlib.sha256(resolved.read_bytes()).hexdigest(),
    }


def _split_summary(examples: Sequence[TrainingExample], path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "clipCount": len(examples),
        "clipIdsSha256": _values_sha256(item.example_id for item in examples),
        "durationMs": sum(item.duration_ms for item in examples),
        "speakerCount": len({item.speaker_id for item in examples}),
        "lectureCount": len({item.lecture_id for item in examples}),
    }


def _values_sha256(values: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for value in sorted(values):
        digest.update(value.encode())
        digest.update(b"\n")
    return digest.hexdigest()
