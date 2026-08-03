from __future__ import annotations

import argparse
import hashlib
import json
import random
import wave
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SPLIT_RATIOS = {"train": 0.8, "dev": 0.1, "test": 0.1}


@dataclass(frozen=True)
class AihubSample:
    clip_id: str
    audio_path: Path
    annotation_path: Path
    reference: str
    speaker_id: str
    lecture_id: str
    category: str
    duration_ms: int
    sha256: str | None
    sample_rate_hz: int = 16_000
    channels: int = 1
    sample_width_bytes: int = 2
    audio_duration_ms: int = 0


@dataclass(frozen=True)
class SplitComponent:
    key: str
    samples: tuple[AihubSample, ...]

    @property
    def duration_ms(self) -> int:
        return sum(sample.duration_ms for sample in self.samples)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    report = prepare_aihub_dataset(
        json_root=args.json_root,
        wav_root=args.wav_root,
        output_root=args.output_root,
        seed=args.seed,
        hash_audio=args.hash_audio,
        golden_minutes=args.golden_minutes,
    )
    print(json.dumps(report, ensure_ascii=False))
    if args.strict and report["status"] != "ready":
        return 2
    return 0


def prepare_aihub_dataset(
    *,
    json_root: Path,
    wav_root: Path,
    output_root: Path,
    seed: int,
    hash_audio: bool,
    golden_minutes: float,
) -> dict[str, Any]:
    json_root = json_root.resolve()
    wav_root = wav_root.resolve()
    output_root = output_root.resolve()
    _require_directory(json_root, "JSON")
    _require_directory(wav_root, "WAV")

    json_by_key = _files_by_relative_stem(json_root, ".json")
    wav_by_key = _files_by_relative_stem(wav_root, ".wav")
    matched_keys = sorted(json_by_key.keys() & wav_by_key.keys())
    missing_wav = sorted(json_by_key.keys() - wav_by_key.keys())
    missing_json = sorted(wav_by_key.keys() - json_by_key.keys())

    samples: list[AihubSample] = []
    invalid_annotations: list[dict[str, str]] = []
    for key in matched_keys:
        try:
            samples.append(
                _parse_sample(
                    key,
                    json_by_key[key],
                    wav_by_key[key],
                    hash_audio=hash_audio,
                )
            )
        except (OSError, TypeError, ValueError, json.JSONDecodeError, wave.Error) as exc:
            invalid_annotations.append({"key": key, "error": str(exc)})

    assignments = assign_group_disjoint_splits(samples, seed=seed)
    manifests_dir = output_root / "manifests"
    reports_dir = output_root / "reports"
    manifests_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    manifest_hashes: dict[str, str] = {}
    for split in _SPLIT_RATIOS:
        records = [
            _evaluation_record(sample, split)
            for sample in samples
            if assignments[sample.clip_id] == split
        ]
        manifest_hashes[split] = _write_jsonl(manifests_dir / f"{split}.jsonl", records)

    golden = _select_golden(
        [sample for sample in samples if assignments[sample.clip_id] == "test"],
        target_ms=round(golden_minutes * 60_000),
        seed=seed,
    )
    manifest_hashes["golden"] = _write_jsonl(
        manifests_dir / "golden.jsonl",
        [_evaluation_record(sample, "golden") for sample in golden],
    )
    manifest_hashes["sourceIndex"] = _write_jsonl(
        manifests_dir / "source-index.jsonl",
        [
            _source_record(sample, assignments[sample.clip_id])
            for sample in sorted(samples, key=lambda item: item.clip_id)
        ],
    )

    split_summary = _build_split_summary(samples, assignments)
    split_summary["manifestSha256"] = manifest_hashes
    split_summary["seed"] = seed
    _write_json(reports_dir / "split-summary.json", split_summary)

    unsupported_audio = [sample for sample in samples if not _is_pcm16_mono_16khz(sample)]
    duration_mismatches = [
        sample for sample in samples if abs(sample.audio_duration_ms - sample.duration_ms) > 250
    ]
    warnings = _readiness_warnings(
        missing_wav=missing_wav,
        missing_json=missing_json,
        invalid_annotations=invalid_annotations,
        unsupported_audio=unsupported_audio,
        split_summary=split_summary,
    )
    audit = {
        "schemaVersion": 1,
        "jsonRoot": str(json_root),
        "wavRoot": str(wav_root),
        "jsonFiles": len(json_by_key),
        "wavFiles": len(wav_by_key),
        "matchedFiles": len(matched_keys),
        "validSamples": len(samples),
        "missingWavCount": len(missing_wav),
        "missingJsonCount": len(missing_json),
        "missingWavExamples": missing_wav[:100],
        "missingJsonExamples": missing_json[:100],
        "invalidAnnotationCount": len(invalid_annotations),
        "invalidAnnotationExamples": invalid_annotations[:100],
        "totalAudioDurationMs": sum(sample.audio_duration_ms for sample in samples),
        "audioFormatCounts": dict(
            sorted(
                Counter(
                    f"{sample.sample_rate_hz}Hz/{sample.channels}ch/"
                    f"{sample.sample_width_bytes * 8}bit"
                    for sample in samples
                ).items()
            )
        ),
        "unsupportedAudioCount": len(unsupported_audio),
        "unsupportedAudioExamples": [sample.clip_id for sample in unsupported_audio[:100]],
        "durationMismatchCount": len(duration_mismatches),
        "durationMismatchExamples": [
            {
                "id": sample.clip_id,
                "annotationDurationMs": sample.duration_ms,
                "audioDurationMs": sample.audio_duration_ms,
            }
            for sample in duration_mismatches[:100]
        ],
        "warnings": warnings,
    }
    _write_json(reports_dir / "audit.json", audit)
    return {
        "status": "ready" if not warnings else "incomplete",
        "validSamples": len(samples),
        "jsonFiles": len(json_by_key),
        "wavFiles": len(wav_by_key),
        "warnings": warnings,
        "outputRoot": str(output_root),
    }


def assign_group_disjoint_splits(
    samples: Sequence[AihubSample],
    *,
    seed: int,
) -> dict[str, str]:
    if not samples:
        return {}

    parent: dict[str, str] = {}

    def find(node: str) -> str:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for sample in samples:
        union(f"speaker:{sample.speaker_id}", f"lecture:{sample.lecture_id}")

    grouped: dict[str, list[AihubSample]] = defaultdict(list)
    for sample in samples:
        grouped[find(f"speaker:{sample.speaker_id}")].append(sample)

    components = [SplitComponent(key=key, samples=tuple(values)) for key, values in grouped.items()]
    randomizer = random.Random(seed)
    randomizer.shuffle(components)
    components.sort(key=lambda component: component.duration_ms, reverse=True)

    total_ms = sum(component.duration_ms for component in components)
    targets = {name: total_ms * ratio for name, ratio in _SPLIT_RATIOS.items()}
    current = {name: 0 for name in _SPLIT_RATIOS}
    component_split: dict[str, str] = {}

    for component in components:
        split = max(
            _SPLIT_RATIOS,
            key=lambda name: (
                (targets[name] - current[name]) / max(targets[name], 1),
                _split_tie_breaker(name),
            ),
        )
        component_split[component.key] = split
        current[split] += component.duration_ms

    assignments: dict[str, str] = {}
    for component in components:
        split = component_split[component.key]
        for sample in component.samples:
            assignments[sample.clip_id] = split
    return assignments


def _parse_sample(
    key: str,
    annotation_path: Path,
    audio_path: Path,
    *,
    hash_audio: bool,
) -> AihubSample:
    value = json.loads(annotation_path.read_text(encoding="utf-8-sig"))
    dataset = _mapping(value, "01_dataset")
    source = _mapping(value, "02_srcinfo")
    lecture = _mapping(value, "03_lectureinfo")
    speaker = _mapping(value, "05_speakerinfo")
    transcription = _mapping(value, "06_transcription")

    source_path = _text(dataset, "3_src_path")
    expected_key = Path(source_path).with_suffix("").as_posix()
    if expected_key.startswith("source/"):
        expected_key = expected_key.removeprefix("source/")
    if expected_key != key:
        raise ValueError(f"annotation source path mismatch: {expected_key} != {key}")

    clip_id = key.replace("/", ".")
    duration_ms = round(float(_text(dataset, "9_speech_length")) * 1_000)
    if duration_ms <= 0:
        raise ValueError("speech duration must be positive")

    category = "/".join(
        part
        for part in (
            _text(dataset, "5_category"),
            _text(lecture, "3_major_category"),
        )
        if part
    )
    sample_rate_hz, channels, sample_width_bytes, audio_duration_ms = _inspect_wav(audio_path)
    return AihubSample(
        clip_id=clip_id,
        audio_path=audio_path.resolve(),
        annotation_path=annotation_path.resolve(),
        reference=_text(transcription, "1_text"),
        speaker_id=_text(speaker, "1_id"),
        lecture_id=_text(source, "1_id"),
        category=category,
        duration_ms=duration_ms,
        sha256=_sha256(audio_path) if hash_audio else None,
        sample_rate_hz=sample_rate_hz,
        channels=channels,
        sample_width_bytes=sample_width_bytes,
        audio_duration_ms=audio_duration_ms,
    )


def _files_by_relative_stem(root: Path, suffix: str) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for path in sorted(root.rglob(f"*{suffix}")):
        key = path.relative_to(root).with_suffix("").as_posix()
        if key in files:
            raise ValueError(f"duplicate relative key: {key}")
        files[key] = path
    return files


def _evaluation_record(sample: AihubSample, split: str) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": sample.clip_id,
        "audioPath": str(sample.audio_path),
        "reference": sample.reference,
        "language": "ko-KR",
        "speakerId": sample.speaker_id,
        "split": split,
        "terms": [],
        "consent": "AI-Hub-license",
    }
    if sample.sha256 is not None:
        record["sha256"] = sample.sha256
    return record


def _source_record(sample: AihubSample, split: str) -> dict[str, Any]:
    return {
        **_evaluation_record(sample, split),
        "annotationPath": str(sample.annotation_path),
        "lectureId": sample.lecture_id,
        "category": sample.category,
        "durationMs": sample.duration_ms,
        "audioDurationMs": sample.audio_duration_ms,
        "sampleRateHz": sample.sample_rate_hz,
        "channels": sample.channels,
        "sampleWidthBytes": sample.sample_width_bytes,
    }


def _select_golden(
    samples: Sequence[AihubSample],
    *,
    target_ms: int,
    seed: int,
) -> tuple[AihubSample, ...]:
    ordered = sorted(
        samples,
        key=lambda sample: hashlib.sha256(f"{seed}:{sample.clip_id}".encode()).hexdigest(),
    )
    selected: list[AihubSample] = []
    duration_ms = 0
    seen_speakers: set[str] = set()
    for sample in ordered:
        if duration_ms >= target_ms and len(seen_speakers) >= min(3, len(ordered)):
            break
        selected.append(sample)
        duration_ms += sample.duration_ms
        seen_speakers.add(sample.speaker_id)
    return tuple(selected)


def _build_split_summary(
    samples: Sequence[AihubSample],
    assignments: dict[str, str],
) -> dict[str, Any]:
    summary: dict[str, Any] = {"schemaVersion": 1, "splits": {}}
    speaker_sets: dict[str, set[str]] = {}
    lecture_sets: dict[str, set[str]] = {}
    for split in _SPLIT_RATIOS:
        selected = [sample for sample in samples if assignments[sample.clip_id] == split]
        speakers = {sample.speaker_id for sample in selected}
        lectures = {sample.lecture_id for sample in selected}
        speaker_sets[split] = speakers
        lecture_sets[split] = lectures
        summary["splits"][split] = {
            "clips": len(selected),
            "durationMs": sum(sample.duration_ms for sample in selected),
            "speakers": len(speakers),
            "lectures": len(lectures),
        }

    summary["speakerIntersections"] = _intersection_counts(speaker_sets)
    summary["lectureIntersections"] = _intersection_counts(lecture_sets)
    return summary


def _intersection_counts(values: dict[str, set[str]]) -> dict[str, int]:
    names = tuple(values)
    return {
        f"{left}:{right}": len(values[left] & values[right])
        for index, left in enumerate(names)
        for right in names[index + 1 :]
    }


def _readiness_warnings(
    *,
    missing_wav: Sequence[str],
    missing_json: Sequence[str],
    invalid_annotations: Sequence[dict[str, str]],
    unsupported_audio: Sequence[AihubSample],
    split_summary: dict[str, Any],
) -> list[str]:
    warnings: list[str] = []
    if missing_wav:
        warnings.append(f"{len(missing_wav)} JSON files have no matching WAV")
    if missing_json:
        warnings.append(f"{len(missing_json)} WAV files have no matching JSON")
    if invalid_annotations:
        warnings.append(f"{len(invalid_annotations)} matched annotations are invalid")
    if unsupported_audio:
        warnings.append(
            f"{len(unsupported_audio)} WAV files require conversion to PCM16 mono 16 kHz"
        )

    if any(split_summary["speakerIntersections"].values()):
        warnings.append("speaker leakage exists between splits")
    if any(split_summary["lectureIntersections"].values()):
        warnings.append("lecture leakage exists between splits")

    test = split_summary["splits"]["test"]
    if test["clips"] < 100:
        warnings.append("test split has fewer than 100 clips")
    if test["durationMs"] < 3_600_000:
        warnings.append("test split is shorter than 60 minutes")
    if test["speakers"] < 8:
        warnings.append("test split has fewer than 8 speakers")
    return warnings


def _mapping(value: Any, key: str) -> dict[str, Any]:
    selected = value.get(key) if isinstance(value, dict) else None
    if not isinstance(selected, dict):
        raise TypeError(f"{key} must be an object")
    return selected


def _text(value: dict[str, Any], key: str) -> str:
    selected = value.get(key)
    if not isinstance(selected, (str, int, float)) or not str(selected).strip():
        raise TypeError(f"{key} must be a non-blank scalar")
    return str(selected).strip()


def _write_jsonl(path: Path, records: Sequence[dict[str, Any]]) -> str:
    payload = "".join(
        json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n" for record in records
    )
    path.write_text(payload, encoding="utf-8")
    return hashlib.sha256(payload.encode()).hexdigest()


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inspect_wav(path: Path) -> tuple[int, int, int, int]:
    with wave.open(str(path), "rb") as source:
        if source.getcomptype() != "NONE":
            raise ValueError(f"compressed WAV is not supported: {source.getcomptype()}")
        sample_rate_hz = source.getframerate()
        channels = source.getnchannels()
        sample_width_bytes = source.getsampwidth()
        frame_count = source.getnframes()
    if sample_rate_hz <= 0 or channels <= 0 or sample_width_bytes <= 0 or frame_count <= 0:
        raise ValueError("WAV header contains a non-positive audio field")
    return (
        sample_rate_hz,
        channels,
        sample_width_bytes,
        round(frame_count * 1_000 / sample_rate_hz),
    )


def _is_pcm16_mono_16khz(sample: AihubSample) -> bool:
    return (
        sample.sample_rate_hz == 16_000 and sample.channels == 1 and sample.sample_width_bytes == 2
    )


def _split_tie_breaker(split: str) -> int:
    return {"train": 2, "dev": 1, "test": 0}[split]


def _require_directory(path: Path, label: str) -> None:
    if not path.is_dir():
        raise ValueError(f"{label} root does not exist: {path}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare AI Hub Korean lecture STT data")
    parser.add_argument("--json-root", type=Path, required=True)
    parser.add_argument("--wav-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260803)
    parser.add_argument("--golden-minutes", type=float, default=3.0)
    parser.add_argument("--hash-audio", action="store_true")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit 2 when upload/matching/split readiness is incomplete",
    )
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
