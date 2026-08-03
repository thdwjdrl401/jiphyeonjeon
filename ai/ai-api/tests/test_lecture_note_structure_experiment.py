from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ValidationError

from app.lecture_notes.models import (
    LectureNoteDraftItem,
    LectureNoteDraftItemType,
    LectureNoteDraftTopicContent,
    LectureNoteDraftUpdateAction,
    LectureNoteDraftUpdateResult,
)
from scripts.compare_lecture_note_structures import (
    DETAILED_SPEC,
    MINIMAL_SPEC,
    CandidateEvaluation,
    CandidateSpec,
    ExperimentNote,
    LectureSample,
    MinimalDraftItem,
    MinimalItemType,
    MinimalTopicContent,
    MinimalUpdateResult,
    PairEvaluation,
    StructureExperimentModel,
    _apply_experiment_update,
    _judge_pair,
    _missing_existing_item_count,
    _render_experiment_markdown,
)


def _minimal_item(
    item_type: MinimalItemType,
    content: str,
    *,
    label: str | None = None,
) -> MinimalDraftItem:
    return MinimalDraftItem(type=item_type, label=label, content=content)


def _minimal_topic(*items: MinimalDraftItem) -> MinimalTopicContent:
    return MinimalTopicContent(
        topicTitle="연쇄법칙",
        overview="합성함수의 변화율이 두 함수의 변화율을 연결함.",
        items=items,
    )


def _valid_minimal_result() -> MinimalUpdateResult:
    return MinimalUpdateResult(
        action=LectureNoteDraftUpdateAction.START_NEW,
        newTopic=_minimal_topic(
            _minimal_item(
                MinimalItemType.CONCEPT,
                "합성함수의 미분 규칙임.",
                label="연쇄법칙",
            ),
        ),
    )


def _valid_detailed_result() -> LectureNoteDraftUpdateResult:
    return LectureNoteDraftUpdateResult(
        action=LectureNoteDraftUpdateAction.START_NEW,
        newTopic=LectureNoteDraftTopicContent(
            topicTitle="연쇄법칙",
            overview="합성함수의 변화율이 두 함수의 변화율을 연결함.",
            items=(
                LectureNoteDraftItem(
                    type=LectureNoteDraftItemType.DEFINITION,
                    label="연쇄법칙",
                    content="합성함수의 미분 규칙임.",
                ),
            ),
        ),
    )


def test_minimal_types_require_concept_label_and_note_style() -> None:
    with pytest.raises(ValidationError, match="CONCEPT requires a label"):
        _minimal_item(MinimalItemType.CONCEPT, "합성함수의 미분 원리임.")

    with pytest.raises(ValidationError, match="concise nominal sentence endings"):
        _minimal_item(MinimalItemType.EXPLANATION, "안쪽 함수를 먼저 미분합니다.")


def test_common_reducer_accumulates_and_renders_all_minimal_roles() -> None:
    start = _valid_minimal_result()
    note = _apply_experiment_update(ExperimentNote(), MINIMAL_SPEC.normalize_update(start))

    update = MinimalUpdateResult(
        action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
        currentTopic=_minimal_topic(
            *_valid_minimal_result().newTopic.items,  # type: ignore[union-attr]
            _minimal_item(
                MinimalItemType.EXPLANATION,
                "바깥 미분값과 안쪽 미분값을 곱해 변화율을 연결함.",
                label="변화율 연결",
            ),
            _minimal_item(
                MinimalItemType.EXAMPLE,
                "(x²+1)³의 미분 결과가 6x(x²+1)²가 됨.",
            ),
            _minimal_item(
                MinimalItemType.CAUTION,
                "안쪽 함수의 미분값 누락에 주의함.",
            ),
        ),
    )
    note = _apply_experiment_update(note, MINIMAL_SPEC.normalize_update(update))
    markdown = _render_experiment_markdown(note, MINIMAL_SPEC)

    assert note.update_sequence == 2
    assert len(note.topics[0].items) == 4
    assert "### 개념" in markdown
    assert "### 설명" in markdown
    assert "### 예시" in markdown
    assert "### 주의사항" in markdown
    assert "### 사실" not in markdown
    assert "### 동작 원리" not in markdown


def test_common_engine_counts_existing_item_loss_without_hiding_it() -> None:
    start = MinimalUpdateResult(
        action=LectureNoteDraftUpdateAction.START_NEW,
        newTopic=_minimal_topic(
            _minimal_item(
                MinimalItemType.CONCEPT,
                "합성함수의 미분 규칙임.",
                label="연쇄법칙",
            ),
            _minimal_item(
                MinimalItemType.CAUTION,
                "안쪽 함수의 미분값을 빠뜨리면 안 됨.",
                label="안쪽 함수",
            ),
        ),
    )
    note = _apply_experiment_update(ExperimentNote(), MINIMAL_SPEC.normalize_update(start))
    drops_caution = MinimalUpdateResult(
        action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
        currentTopic=_minimal_topic(
            _minimal_item(
                MinimalItemType.CONCEPT,
                "합성함수의 미분 규칙임.",
                label="연쇄법칙",
            ),
        ),
    )

    update = MINIMAL_SPEC.normalize_update(drops_caution)

    assert _missing_existing_item_count(note, update) == 1
    assert len(_apply_experiment_update(note, update).topics[-1].items) == 1


def test_candidate_prompts_share_rules_and_describe_every_type() -> None:
    shared_rules = (
        "현재 노트가 비어 있고 lectureText가 유효하면 반드시 START_NEW",
        "items는 중요도를 선별하는 목록이 아니라",
        "기존 currentTopic의 item은 같은 사실을 합치는 경우 외에는 삭제하지 않습니다",
    )
    for rule in shared_rules:
        assert rule in DETAILED_SPEC.system_prompt
        assert rule in MINIMAL_SPEC.system_prompt
    for spec in (DETAILED_SPEC, MINIMAL_SPEC):
        for item_type, description in spec.type_rules:
            assert f"- {item_type}: {description}." in spec.system_prompt


@pytest.mark.parametrize(
    ("spec", "valid_result"),
    ((DETAILED_SPEC, _valid_detailed_result()), (MINIMAL_SPEC, _valid_minimal_result())),
)
def test_structure_models_retry_once_when_parser_rejects_schema(
    spec: CandidateSpec,
    valid_result: BaseModel,
) -> None:
    invalid = _schema_validation_error(spec)
    completions = _FakeCompletions((invalid, valid_result))
    model = _model(spec, completions)

    result = asyncio.run(model.generate(ExperimentNote(), previous_context="", lecture_text="설명"))

    assert result.action is LectureNoteDraftUpdateAction.START_NEW
    assert completions.calls == 2
    assert model.schema_repair_calls == 1
    assert "schema validation" in completions.messages[1][-1]["content"]


@pytest.mark.parametrize("spec", (DETAILED_SPEC, MINIMAL_SPEC))
def test_structure_models_stop_after_second_schema_failure(spec: CandidateSpec) -> None:
    invalid = _schema_validation_error(spec)
    completions = _FakeCompletions((invalid, invalid, _valid_minimal_result()))
    model = _model(spec, completions)

    with pytest.raises(ValidationError):
        asyncio.run(model.generate(ExperimentNote(), previous_context="", lecture_text="설명"))

    assert completions.calls == 2
    assert model.schema_repair_calls == 1


@pytest.mark.parametrize(
    ("swap_order", "preferred", "expected"),
    ((False, "CANDIDATE_ONE", "detailed"), (True, "CANDIDATE_ONE", "minimal")),
)
def test_judge_maps_blinded_candidate_order(
    swap_order: bool,
    preferred: str,
    expected: str,
) -> None:
    score = CandidateEvaluation(
        coverage=5,
        factualFidelity=5,
        nonRedundancy=5,
        structuralFit=5,
        readability=5,
        topicBoundary=5,
        rationale="원문 정보를 충실히 보존함.",
    )
    evaluation = PairEvaluation(
        candidateOne=score,
        candidateTwo=score,
        preferred=preferred,  # type: ignore[arg-type]
        preferenceReason="구조가 더 자연스러움.",
    )
    completions = _FakeCompletions((evaluation,))
    client = SimpleNamespace(beta=SimpleNamespace(chat=SimpleNamespace(completions=completions)))
    sample = LectureSample(
        sampleId="sample",
        category="테스트",
        title="테스트 강의",
        evaluationFocus="후보 순서 은닉",
        windows=("테스트 원문입니다.",),
    )

    result = asyncio.run(
        _judge_pair(
            client,  # type: ignore[arg-type]
            model="test-model",
            sample=sample,
            detailed_markdown="상세",
            minimal_markdown="최소",
            swap_order=swap_order,
            max_output_tokens=2_048,
        )
    )

    assert result["preferred"] == expected


class _FakeCompletions:
    def __init__(self, outcomes: tuple[BaseException | BaseModel, ...]) -> None:
        self.outcomes = outcomes
        self.calls = 0
        self.messages: list[list[dict[str, str]]] = []

    async def parse(self, **kwargs: object) -> SimpleNamespace:
        outcome = self.outcomes[self.calls]
        self.calls += 1
        self.messages.append(kwargs["messages"])  # type: ignore[arg-type]
        if isinstance(outcome, BaseException):
            raise outcome
        message = SimpleNamespace(parsed=outcome, content=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _model(spec: CandidateSpec, completions: _FakeCompletions) -> StructureExperimentModel:
    client = SimpleNamespace(beta=SimpleNamespace(chat=SimpleNamespace(completions=completions)))
    return StructureExperimentModel(
        client=client,  # type: ignore[arg-type]
        model="test-model",
        max_output_tokens=2_048,
        max_prompt_chars=20_000,
        spec=spec,
    )


def _schema_validation_error(spec: CandidateSpec) -> ValidationError:
    with pytest.raises(ValidationError) as invalid:
        spec.response_model.model_validate(
            {
                "action": "START_NEW",
                "currentTopic": None,
                "newTopic": None,
            }
        )
    return invalid.value
