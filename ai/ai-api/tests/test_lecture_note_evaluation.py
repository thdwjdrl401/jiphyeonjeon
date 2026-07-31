import json
from pathlib import Path

from pydantic import TypeAdapter

from app.lecture_notes import LectureNoteDecisionAction, LectureNoteModelResult
from app.lecture_notes.evaluation import (
    LectureNoteEvaluationCase,
    summarize_evaluation,
)

CASES_PATH = Path(__file__).parents[1] / "scripts" / "lecture_note_prompt_cases.json"


def test_fixed_prompt_cases_cover_ignore_append_and_start_new() -> None:
    cases = TypeAdapter(tuple[LectureNoteEvaluationCase, ...]).validate_python(
        json.loads(CASES_PATH.read_text(encoding="utf-8"))
    )

    assert len(cases) == 8
    assert {case.expectedAction for case in cases} == {
        LectureNoteDecisionAction.IGNORE,
        LectureNoteDecisionAction.APPEND,
        LectureNoteDecisionAction.START_NEW,
    }


def test_evaluation_summary_counts_over_segmentation_and_ignored_content() -> None:
    cases = (
        LectureNoteEvaluationCase(
            caseId="append-case",
            lectureText="추가 설명",
            expectedAction=LectureNoteDecisionAction.APPEND,
            rationale="현재 주제 설명",
        ),
        LectureNoteEvaluationCase(
            caseId="ignore-case",
            currentTopicTitle="현재 주제",
            lectureText="쉬는 시간",
            expectedAction=LectureNoteDecisionAction.IGNORE,
            rationale="운영 안내",
        ),
    )
    predictions = {
        "append-case": LectureNoteModelResult(action=LectureNoteDecisionAction.IGNORE),
        "ignore-case": LectureNoteModelResult(
            action=LectureNoteDecisionAction.START_NEW,
            topicTitle="쉬는 시간",
            keyPoints=("10분간 쉽니다.",),
        ),
    }

    summary = summarize_evaluation(cases, predictions)

    assert summary.actionMatches == 0
    assert summary.overSegmentationCount == 1
    assert summary.ignoredRequiredContentCount == 1


def test_first_start_new_is_equivalent_to_append_without_over_segmentation() -> None:
    case = LectureNoteEvaluationCase(
        caseId="first-note",
        lectureText="첫 요점",
        expectedAction=LectureNoteDecisionAction.APPEND,
        rationale="첫 topic 생성",
    )
    prediction = LectureNoteModelResult(
        action=LectureNoteDecisionAction.START_NEW,
        topicTitle="첫 주제",
        keyPoints=("첫 요점이다.",),
    )

    summary = summarize_evaluation((case,), {case.caseId: prediction})

    assert summary.actionMatches == 1
    assert summary.overSegmentationCount == 0
