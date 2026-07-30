from __future__ import annotations

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field

from app.lecture_notes.models import (
    LectureNoteDecisionAction,
    LectureNoteModelRequest,
    LectureNoteModelResult,
)

_SESSION_ID = "11111111-1111-4111-8111-111111111111"
_LESSON_ID = "22222222-2222-4222-8222-222222222222"


class LectureNoteEvaluationCase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    caseId: str = Field(min_length=1, max_length=80)
    currentTopicTitle: str | None = None
    currentKeyPoints: tuple[str, ...] = ()
    previousTopicTitle: str | None = None
    previousContext: str = ""
    lectureText: str = Field(min_length=1)
    expectedAction: LectureNoteDecisionAction
    rationale: str = Field(min_length=1)

    def to_model_request(self) -> LectureNoteModelRequest:
        return LectureNoteModelRequest(
            session_id=_SESSION_ID,
            lesson_id=_LESSON_ID,
            stt_session_id=f"evaluation-{self.caseId}",
            current_topic_title=self.currentTopicTitle,
            current_key_points=self.currentKeyPoints,
            previous_topic_title=self.previousTopicTitle,
            previous_context=self.previousContext,
            text=self.lectureText,
        )


class LectureNoteEvaluationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    totalCases: int
    validResponses: int
    actionMatches: int
    overSegmentationCount: int
    ignoredRequiredContentCount: int


def summarize_evaluation(
    cases: tuple[LectureNoteEvaluationCase, ...],
    predictions: Mapping[str, LectureNoteModelResult | None],
) -> LectureNoteEvaluationSummary:
    valid_responses = 0
    action_matches = 0
    over_segmentation = 0
    ignored_required = 0
    for case in cases:
        prediction = predictions.get(case.caseId)
        if prediction is None:
            continue
        valid_responses += 1
        if _actions_are_equivalent(case, prediction):
            action_matches += 1
        if (
            prediction.action is LectureNoteDecisionAction.START_NEW
            and case.expectedAction is not LectureNoteDecisionAction.START_NEW
            and case.currentTopicTitle is not None
        ):
            over_segmentation += 1
        if (
            prediction.action is LectureNoteDecisionAction.IGNORE
            and case.expectedAction is not LectureNoteDecisionAction.IGNORE
        ):
            ignored_required += 1
    return LectureNoteEvaluationSummary(
        totalCases=len(cases),
        validResponses=valid_responses,
        actionMatches=action_matches,
        overSegmentationCount=over_segmentation,
        ignoredRequiredContentCount=ignored_required,
    )


def _actions_are_equivalent(
    case: LectureNoteEvaluationCase,
    prediction: LectureNoteModelResult,
) -> bool:
    if prediction.action is case.expectedAction:
        return True
    return (
        case.currentTopicTitle is None
        and case.expectedAction is LectureNoteDecisionAction.APPEND
        and prediction.action is LectureNoteDecisionAction.START_NEW
    )
