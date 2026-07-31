from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Literal

from pydantic import TypeAdapter

from app.adapters.gms_openai_lecture_note import GmsOpenAILectureNoteModel
from app.config import load_settings
from app.lecture_notes.evaluation import (
    LectureNoteEvaluationCase,
    summarize_evaluation,
)
from app.lecture_notes.models import LectureNoteModelResult

DEFAULT_CASES = Path(__file__).with_name("lecture_note_prompt_cases.json")


async def _evaluate(
    version: Literal["v1", "v2"],
    cases: tuple[LectureNoteEvaluationCase, ...],
    concurrency: int,
) -> dict[str, object]:
    settings = load_settings()
    if settings.gms_api_key is None:
        raise ValueError("AI_API_GMS_API_KEY is required")
    model = GmsOpenAILectureNoteModel(
        api_key=settings.gms_api_key.get_secret_value(),
        model=settings.lecture_note_model or settings.gms_model,
        max_output_tokens=settings.lecture_note_max_output_tokens,
        max_prompt_chars=settings.lecture_note_max_prompt_chars,
        timeout_seconds=settings.lecture_note_timeout_seconds,
        prompt_version=version,
    )
    predictions = {}
    semaphore = asyncio.Semaphore(concurrency)

    async def evaluate_case(
        case: LectureNoteEvaluationCase,
    ) -> tuple[LectureNoteModelResult | None, dict[str, object]]:
        async with semaphore:
            try:
                prediction = await model.generate(case.to_model_request())
            except Exception as exc:
                return None, {
                    "caseId": case.caseId,
                    "expectedAction": case.expectedAction,
                    "errorCode": type(exc).__name__,
                }
            return prediction, {
                "caseId": case.caseId,
                "expectedAction": case.expectedAction,
                "actual": prediction.model_dump(mode="json"),
                "rationale": case.rationale,
            }

    try:
        evaluated = await asyncio.gather(*(evaluate_case(case) for case in cases))
        details = []
        for case, (prediction, detail) in zip(cases, evaluated, strict=True):
            predictions[case.caseId] = prediction
            details.append(detail)
    finally:
        await model.aclose()
    return {
        "promptVersion": version,
        "summary": summarize_evaluation(cases, predictions).model_dump(mode="json"),
        "details": details,
    }


async def _main(cases_path: Path, concurrency: int) -> None:
    raw_cases = json.loads(cases_path.read_text(encoding="utf-8"))
    cases = TypeAdapter(tuple[LectureNoteEvaluationCase, ...]).validate_python(raw_cases)
    reports = [await _evaluate(version, cases, concurrency) for version in ("v1", "v2")]
    print(json.dumps({"cases": str(cases_path), "reports": reports}, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="강의 노트 prompt v1/v2 고정 샘플 A/B")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--concurrency", type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    asyncio.run(_main(args.cases, args.concurrency))


if __name__ == "__main__":
    main()
