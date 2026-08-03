from __future__ import annotations

import csv
import io
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

_SECRET_KEYS = frozenset(
    {
        "secret",
        "password",
        "token",
        "apiKey",
        "api_key",
        "authorization",
    }
)


def write_replay_artifacts(report: Mapping[str, Any], artifact_dir: Path) -> tuple[Path, ...]:
    _reject_secret_keys(report)
    artifact_dir.mkdir(parents=True, exist_ok=False)

    candidates = _sequence_of_mappings(report.get("candidates"), "candidates")
    segment_plans = _mapping(report.get("segmentPlans"), "segmentPlans")
    run = {key: value for key, value in report.items() if key not in {"candidates", "segmentPlans"}}
    run["candidates"] = [
        {key: value for key, value in candidate.items() if key not in {"clips", "summary"}}
        for candidate in candidates
    ]

    summary = {
        "schemaVersion": report.get("schemaVersion", 1),
        "comparability": "COMPARABLE",
        "operationalGate": _operational_gate(candidates),
        "candidates": [
            {
                "name": candidate["name"],
                "backend": candidate["backend"],
                "modelId": candidate["modelId"],
                "summary": candidate["summary"],
            }
            for candidate in candidates
        ],
    }

    paths = (
        _write_json(artifact_dir / "run.json", run),
        _write_jsonl(
            artifact_dir / "segment-plan.jsonl",
            _segment_plan_records(candidates, segment_plans),
        ),
        _write_jsonl(artifact_dir / "samples.jsonl", _sample_records(candidates)),
        _write_json(artifact_dir / "summary.json", summary),
        _write_comparison_csv(artifact_dir / "comparison.csv", candidates),
        _write_report_markdown(artifact_dir / "report.md", report, summary),
    )
    return paths


def _segment_plan_records(
    candidates: Sequence[Mapping[str, Any]],
    segment_plans: Mapping[str, Any],
) -> list[dict[str, Any]]:
    first_clips = _sequence_of_mappings(candidates[0].get("clips"), "candidate clips")
    audio_by_clip = {str(clip["id"]): clip.get("audioSha256") for clip in first_clips}
    hash_by_clip = {str(clip["id"]): clip.get("segmentPlanSha256") for clip in first_clips}
    return [
        {
            "clipId": clip_id,
            "audioSha256": audio_by_clip.get(clip_id),
            "segmentPlanSha256": hash_by_clip.get(clip_id),
            "segments": segment_plans[clip_id],
        }
        for clip_id in sorted(segment_plans)
    ]


def _sample_records(candidates: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for candidate in candidates:
        clips = _sequence_of_mappings(candidate.get("clips"), "candidate clips")
        for clip in clips:
            records.append(
                {
                    "candidate": candidate["name"],
                    "backend": candidate["backend"],
                    "modelId": candidate["modelId"],
                    **clip,
                }
            )
    return sorted(records, key=lambda item: (str(item["candidate"]), str(item["id"])))


def _operational_gate(candidates: Sequence[Mapping[str, Any]]) -> str:
    for candidate in candidates:
        summary = _mapping(candidate.get("summary"), "candidate summary")
        if any(
            int(summary.get(field, 0) or 0) > 0
            for field in (
                "missingFinalCount",
                "warningCount",
                "failureCount",
                "timeoutCount",
                "frameDropCount",
                "segmentDropCount",
            )
        ):
            return "FAIL"
    return "PASS"


def _write_comparison_csv(
    path: Path,
    candidates: Sequence[Mapping[str, Any]],
) -> Path:
    columns = (
        "name",
        "backend",
        "modelId",
        "precision",
        "outputMode",
        "workerSlots",
        "clipCount",
        "segmentCount",
        "meanNormalizedCer",
        "meanLiteralNormalizedCer",
        "meanRealTimeFactor",
        "p50SpeechEndToFinalMs",
        "p95SpeechEndToFinalMs",
        "missingFinalCount",
        "warningCount",
        "peakCudaAllocatedBytes",
        "peakCudaReservedBytes",
    )
    target = io.StringIO(newline="")
    writer = csv.DictWriter(target, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for candidate in candidates:
        candidate_summary = _mapping(candidate.get("summary"), "candidate summary")
        writer.writerow(
            {column: candidate.get(column, candidate_summary.get(column)) for column in columns}
        )
    path.write_text(target.getvalue(), encoding="utf-8")
    return path


def _write_report_markdown(
    path: Path,
    report: Mapping[str, Any],
    summary: Mapping[str, Any],
) -> Path:
    candidates = _sequence_of_mappings(summary.get("candidates"), "summary candidates")
    lines = [
        "# STT 운영 VAD 비교 보고서",
        "",
        f"- 비교 가능성: **{summary['comparability']}**",
        f"- 운영 무결성 gate: **{summary['operationalGate']}**",
        f"- split: `{_markdown(report.get('split'))}`",
        f"- mode/workers: `{_markdown(report.get('mode'))}` / `{_markdown(report.get('workers'))}`",
        f"- manifest SHA-256: `{_markdown(report.get('manifestSha256'))}`",
        "",
        "| candidate | backend | model | output | multi-ref CER | literal CER | RTF | p95 final ms | missing | warnings |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for candidate in candidates:
        candidate_summary = _mapping(candidate.get("summary"), "candidate summary")
        lines.append(
            "| "
            + " | ".join(
                (
                    _markdown(candidate.get("name")),
                    _markdown(candidate.get("backend")),
                    _markdown(candidate.get("modelId")),
                    _markdown(_candidate_output_mode(report, str(candidate["name"]))),
                    _number(candidate_summary.get("meanNormalizedCer")),
                    _number(candidate_summary.get("meanLiteralNormalizedCer")),
                    _number(candidate_summary.get("meanRealTimeFactor")),
                    _number(candidate_summary.get("p95SpeechEndToFinalMs")),
                    _number(candidate_summary.get("missingFinalCount")),
                    _number(candidate_summary.get("warningCount")),
                )
            )
            + " |"
        )
    lines.extend(
        (
            "",
            "모델 우열은 이 표의 평균 하나로 자동 확정하지 않는다. 동일 dev 조건에서 후보를 고정한 뒤",
            "test를 최종 한 번 실행하고 ADR-0037/0040의 정확도·지연·누락 gate를 함께 판정한다.",
            "",
        )
    )
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _candidate_output_mode(report: Mapping[str, Any], name: str) -> Any:
    candidates = _sequence_of_mappings(report.get("candidates"), "candidates")
    return next(
        (candidate.get("outputMode") for candidate in candidates if candidate.get("name") == name),
        None,
    )


def _write_json(path: Path, value: Any) -> Path:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _write_jsonl(path: Path, values: Sequence[Mapping[str, Any]]) -> Path:
    path.write_text(
        "".join(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n" for value in values),
        encoding="utf-8",
    )
    return path


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be an object")
    return value


def _sequence_of_mappings(value: Any, name: str) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise TypeError(f"{name} must be an array")
    if not all(isinstance(item, Mapping) for item in value):
        raise TypeError(f"{name} entries must be objects")
    return tuple(value)


def _reject_secret_keys(value: Any, *, path: str = "root") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if str(key) in _SECRET_KEYS:
                raise ValueError(f"secret field is forbidden in report: {path}.{key}")
            _reject_secret_keys(child, path=f"{path}.{key}")
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for index, child in enumerate(value):
            _reject_secret_keys(child, path=f"{path}[{index}]")


def _markdown(value: Any) -> str:
    return "-" if value is None else str(value).replace("|", "\\|").replace("\n", " ")


def _number(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)
