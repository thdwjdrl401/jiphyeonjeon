import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.adapters.gms_openai_lecture_note import GmsOpenAILectureNoteModel, is_reasoning_model
from app.lecture_notes import (
    LectureNote,
    LectureNoteDecisionAction,
    LectureNoteDraft,
    LectureNoteDraftItem,
    LectureNoteDraftItemType,
    LectureNoteDraftModelRequest,
    LectureNoteDraftTopicContent,
    LectureNoteDraftUpdateAction,
    LectureNoteDraftUpdateResult,
    LectureNoteModelRequest,
    LectureNoteRefinementRequest,
    LectureNoteTopic,
)


class FakeCompletions:
    def __init__(self, content: str) -> None:
        self.content = content
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


class FakeClient:
    def __init__(self, content: str) -> None:
        self.chat = SimpleNamespace(completions=FakeCompletions(content))


class FakeDraftCompletions:
    def __init__(self, outcomes: tuple[BaseException | LectureNoteDraftUpdateResult, ...]) -> None:
        self.outcomes = outcomes
        self.calls = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes[len(self.calls) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=None, parsed=outcome))]
        )


class FakeDraftClient:
    def __init__(self, *outcomes: BaseException | LectureNoteDraftUpdateResult) -> None:
        self.beta = SimpleNamespace(
            chat=SimpleNamespace(completions=FakeDraftCompletions(outcomes))
        )


def _request() -> LectureNoteModelRequest:
    return LectureNoteModelRequest(
        session_id="11111111-1111-4111-8111-111111111111",
        lesson_id="22222222-2222-4222-8222-222222222222",
        stt_session_id="attempt-1",
        current_topic_title="Access Token",
        current_key_points=("API 접근에 사용한다.",),
        previous_topic_title="인증 개요",
        previous_context="이전 문장입니다.",
        text=" Refresh Token은 재발급에 사용합니다.",
    )


def _draft_request() -> LectureNoteDraftModelRequest:
    return LectureNoteDraftModelRequest(
        session_id="11111111-1111-4111-8111-111111111111",
        lesson_id="22222222-2222-4222-8222-222222222222",
        stt_session_id="attempt-1",
        note=LectureNoteDraft(),
        previous_context="이전 문장입니다.",
        text="미분계수는 한 점의 순간 변화율입니다.",
    )


def _draft_result() -> LectureNoteDraftUpdateResult:
    return LectureNoteDraftUpdateResult(
        action=LectureNoteDraftUpdateAction.START_NEW,
        newTopic=LectureNoteDraftTopicContent(
            topicTitle="미분계수",
            overview="한 점에서 정의한 함수의 순간 변화율.",
            items=(
                LectureNoteDraftItem(
                    type=LectureNoteDraftItemType.DEFINITION,
                    label="미분계수",
                    content="한 점에서 정의한 함수의 순간 변화율.",
                ),
            ),
        ),
    )


def _semantic_invalid_result() -> LectureNoteDraftUpdateResult:
    return LectureNoteDraftUpdateResult(
        action=LectureNoteDraftUpdateAction.UPDATE_CURRENT,
        currentTopic=_draft_result().newTopic,
    )


def test_draft_model_uses_detailed_active_topic_schema() -> None:
    async def scenario() -> None:
        client = FakeDraftClient(_draft_result())
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=4_096,
            max_prompt_chars=20_000,
            timeout_seconds=30,
            client=client,
        )

        result = await model.generate_draft(_draft_request())

        assert result == _draft_result()
        call = client.beta.chat.completions.calls[0]
        assert call["response_format"] is LectureNoteDraftUpdateResult
        assert "stream" not in call
        prompt = json.loads(call["messages"][1]["content"])
        assert prompt["currentTopic"] is None
        assert prompt["lectureText"].startswith("미분계수")
        system_prompt = call["messages"][0]["content"]
        for item_type in LectureNoteDraftItemType:
            assert item_type.value in system_prompt

    asyncio.run(scenario())


def test_draft_model_retries_schema_failure_once() -> None:
    async def scenario() -> None:
        invalid = _invalid_draft_error()
        client = FakeDraftClient(invalid, _draft_result())
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=4_096,
            max_prompt_chars=20_000,
            timeout_seconds=30,
            client=client,
        )

        assert await model.generate_draft(_draft_request()) == _draft_result()
        assert len(client.beta.chat.completions.calls) == 2
        repair = client.beta.chat.completions.calls[1]["messages"][-1]["content"]
        assert "schema validation" in repair

    asyncio.run(scenario())


def test_draft_model_stops_after_second_schema_failure() -> None:
    async def scenario() -> None:
        invalid = _invalid_draft_error()
        client = FakeDraftClient(invalid, invalid, _draft_result())
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=4_096,
            max_prompt_chars=20_000,
            timeout_seconds=30,
            client=client,
        )

        with pytest.raises(ValidationError):
            await model.generate_draft(_draft_request())
        assert len(client.beta.chat.completions.calls) == 2

    asyncio.run(scenario())


def test_draft_model_retries_semantic_failure_once() -> None:
    async def scenario() -> None:
        client = FakeDraftClient(_semantic_invalid_result(), _draft_result())
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=4_096,
            max_prompt_chars=20_000,
            timeout_seconds=30,
            client=client,
        )

        assert await model.generate_draft(_draft_request()) == _draft_result()
        assert len(client.beta.chat.completions.calls) == 2
        repair = client.beta.chat.completions.calls[1]["messages"][-1]["content"]
        assert "전이·보존 계약" in repair

    asyncio.run(scenario())


def test_draft_model_stops_after_second_semantic_failure() -> None:
    async def scenario() -> None:
        invalid = _semantic_invalid_result()
        client = FakeDraftClient(invalid, invalid, _draft_result())
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=4_096,
            max_prompt_chars=20_000,
            timeout_seconds=30,
            client=client,
        )

        with pytest.raises(ValueError, match="requires an active topic"):
            await model.generate_draft(_draft_request())
        assert len(client.beta.chat.completions.calls) == 2

    asyncio.run(scenario())


def test_draft_model_allows_only_one_combined_repair() -> None:
    async def scenario() -> None:
        client = FakeDraftClient(
            _invalid_draft_error(),
            _semantic_invalid_result(),
            _draft_result(),
        )
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=4_096,
            max_prompt_chars=20_000,
            timeout_seconds=30,
            client=client,
        )

        with pytest.raises(ValueError, match="requires an active topic"):
            await model.generate_draft(_draft_request())
        assert len(client.beta.chat.completions.calls) == 2

    asyncio.run(scenario())


def _invalid_draft_error() -> ValidationError:
    with pytest.raises(ValidationError) as invalid:
        LectureNoteDraftUpdateResult.model_validate(
            {"action": "START_NEW", "currentTopic": None, "newTopic": None}
        )
    return invalid.value


def test_model_requests_json_object_and_validates_result() -> None:
    async def scenario() -> None:
        client = FakeClient(
            json.dumps(
                {
                    "action": "START_NEW",
                    "topicTitle": "Refresh Token",
                    "keyPoints": ["Access Token 재발급에 사용한다."],
                },
                ensure_ascii=False,
            )
        )
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=512,
            max_prompt_chars=10_000,
            timeout_seconds=10,
            client=client,
        )

        result = await model.generate(_request())

        assert result.action is LectureNoteDecisionAction.START_NEW
        call = client.chat.completions.calls[0]
        assert call["response_format"] == {"type": "json_object"}
        prompt = json.loads(call["messages"][1]["content"])
        assert prompt["currentTopic"]["title"] == "Access Token"
        assert prompt["previousTopicTitle"] == "인증 개요"
        assert prompt["lectureText"].startswith(" ")
        assert "IGNORE" in call["messages"][0]["content"]
        assert "경계가 불확실하면 APPEND" in call["messages"][0]["content"]

    asyncio.run(scenario())


def test_model_rejects_invalid_structured_json() -> None:
    async def scenario() -> None:
        client = FakeClient('{"action":"APPEND","topicTitle":"주제"}')
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=512,
            max_prompt_chars=10_000,
            timeout_seconds=10,
            client=client,
        )

        with pytest.raises(ValidationError):
            await model.generate(_request())

    asyncio.run(scenario())


def test_model_rejects_non_positive_refinement_limit() -> None:
    with pytest.raises(ValueError, match="refinement limits"):
        GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=512,
            max_prompt_chars=10_000,
            timeout_seconds=10,
            refinement_max_output_tokens=0,
            client=FakeClient("{}"),
        )


def test_v1_baseline_prompt_excludes_ignore_for_ab_evaluation() -> None:
    client = FakeClient('{"action":"APPEND","topicTitle":"주제","keyPoints":["요점"]}')
    model = GmsOpenAILectureNoteModel(
        api_key="test-key",
        model="gpt-test",
        max_output_tokens=512,
        max_prompt_chars=10_000,
        timeout_seconds=10,
        prompt_version="v1",
        client=client,
    )

    asyncio.run(model.generate(_request()))

    system_prompt = client.chat.completions.calls[0]["messages"][0]["content"]
    assert "APPEND 또는 START_NEW" in system_prompt
    assert "IGNORE:" not in system_prompt


def test_refinement_uses_structured_draft_without_raw_caption() -> None:
    async def scenario() -> None:
        client = FakeClient(
            json.dumps(
                {
                    "topics": [
                        {
                            "topicTitle": "Token 갱신",
                            "keyPoints": ["Refresh Token은 재발급에 사용한다."],
                        }
                    ]
                },
                ensure_ascii=False,
            )
        )
        model = GmsOpenAILectureNoteModel(
            api_key="test-key",
            model="gpt-test",
            max_output_tokens=512,
            max_prompt_chars=10_000,
            timeout_seconds=10,
            refinement_max_output_tokens=4_096,
            refinement_max_prompt_chars=50_000,
            refinement_timeout_seconds=55,
            client=client,
        )
        request = LectureNoteRefinementRequest(
            session_id="11111111-1111-4111-8111-111111111111",
            lesson_id="22222222-2222-4222-8222-222222222222",
            note=LectureNote(
                topics=(
                    LectureNoteTopic(
                        topic_id="topic-1",
                        title="Refresh Token",
                        key_points=("재발급에 사용한다.",),
                    ),
                ),
                chunk_sequence=1,
            ),
        )

        result = await model.refine(request)

        assert result.topics[0].topicTitle == "Token 갱신"
        call = client.chat.completions.calls[0]
        assert call["max_completion_tokens"] == 4_096
        assert call["timeout"] == 55
        prompt = json.loads(call["messages"][1]["content"])
        assert prompt == {
            "draftTopics": [
                {
                    "topicTitle": "Refresh Token",
                    "keyPoints": ["재발급에 사용한다."],
                }
            ]
        }
        assert "lectureText" not in prompt

    asyncio.run(scenario())


def _note_model(client, **overrides) -> GmsOpenAILectureNoteModel:
    settings: dict[str, object] = {
        "api_key": "test-key",
        "model": "gpt-test",
        "max_output_tokens": 4_096,
        "max_prompt_chars": 20_000,
        "timeout_seconds": 30,
        "client": client,
        **overrides,
    }
    return GmsOpenAILectureNoteModel(**settings)


def test_non_reasoning_model_keeps_deterministic_temperature() -> None:
    """gpt-4.1 rejects reasoning_effort, so the original temperature=0 path must survive."""

    async def run() -> dict:
        client = FakeClient(json.dumps({"action": "IGNORE", "topicTitle": None, "keyPoints": []}))
        await _note_model(client).generate(_request())
        return client.chat.completions.calls[0]

    call = asyncio.run(run())

    assert call["temperature"] == 0
    assert "reasoning_effort" not in call


def test_reasoning_model_swaps_temperature_for_effort() -> None:
    """gpt-5 models reject temperature and need the effort cap, or one caption window costs
    19s instead of 2s (measured against GMS, 2026-08-04)."""

    async def run() -> dict:
        client = FakeClient(json.dumps({"action": "IGNORE", "topicTitle": None, "keyPoints": []}))
        await _note_model(client, model="gpt-5-nano", reasoning_effort="minimal").generate(
            _request()
        )
        return client.chat.completions.calls[0]

    call = asyncio.run(run())

    assert call["reasoning_effort"] == "minimal"
    assert "temperature" not in call


def test_blank_reasoning_effort_is_rejected_rather_than_sent_empty() -> None:
    with pytest.raises(ValueError, match="reasoning_effort"):
        _note_model(FakeClient("{}"), reasoning_effort="   ")


def _refinement_request() -> LectureNoteRefinementRequest:
    return LectureNoteRefinementRequest(
        session_id="11111111-1111-4111-8111-111111111111",
        lesson_id="22222222-2222-4222-8222-222222222222",
        note=LectureNote(
            topics=(
                LectureNoteTopic(
                    topic_id="topic-1",
                    title="Refresh Token",
                    key_points=("재발급에 사용한다.",),
                ),
            )
        ),
    )


def _sampling_used(client) -> dict:
    return {
        key: value
        for key, value in client.chat.completions.calls[0].items()
        if key in {"temperature", "reasoning_effort"}
    }


def _note_model_for(model: str, client, **overrides) -> GmsOpenAILectureNoteModel:
    settings: dict[str, object] = {
        "api_key": "test-key",
        "model": model,
        "max_output_tokens": 4_096,
        "max_prompt_chars": 20_000,
        "timeout_seconds": 30,
        "client": client,
        **overrides,
    }
    return GmsOpenAILectureNoteModel(**settings)


def test_non_reasoning_model_ignores_a_stale_reasoning_effort() -> None:
    """The live outage: compose left AI_API_LECTURE_NOTE_MODEL empty so the model fell back to
    gpt-4.1, while the effort setting kept its own default — and gpt-4.1 400s on
    reasoning_effort. Deriving from the model makes the leftover setting harmless."""

    async def run() -> dict:
        client = FakeClient(json.dumps({"action": "IGNORE", "topicTitle": None, "keyPoints": []}))
        await _note_model_for("gpt-4.1", client, reasoning_effort="minimal").generate(_request())
        return _sampling_used(client)

    assert asyncio.run(run()) == {"temperature": 0}


def test_reasoning_model_sends_effort_and_never_temperature() -> None:
    async def run() -> dict:
        client = FakeClient(json.dumps({"action": "IGNORE", "topicTitle": None, "keyPoints": []}))
        await _note_model_for("gpt-5-nano", client, reasoning_effort="minimal").generate(_request())
        return _sampling_used(client)

    assert asyncio.run(run()) == {"reasoning_effort": "minimal"}


def test_reasoning_model_without_an_effort_sends_neither_knob() -> None:
    async def run() -> dict:
        client = FakeClient(json.dumps({"action": "IGNORE", "topicTitle": None, "keyPoints": []}))
        await _note_model_for("gpt-5-nano", client, reasoning_effort=None).generate(_request())
        return _sampling_used(client)

    assert asyncio.run(run()) == {}


def test_refinement_uses_the_same_derivation_as_live_generation() -> None:
    """All three call sites share the decision; a fix that only covered `generate` would leave
    the end-of-lecture refinement 400ing, which is where the failure was first noticed."""

    async def run() -> dict:
        client = FakeClient(
            json.dumps({"topics": [{"topicTitle": "Refresh Token", "keyPoints": ["재발급"]}]})
        )
        await _note_model_for("gpt-4.1", client, reasoning_effort="minimal").refine(
            _refinement_request()
        )
        return _sampling_used(client)

    assert asyncio.run(run()) == {"temperature": 0}


@pytest.mark.parametrize(
    ("model", "reasoning"),
    [
        ("gpt-5-nano", True),
        ("GPT-5-Mini", True),
        ("o3-mini", True),
        ("gpt-4.1", False),
        ("gpt-4o", False),
        ("  gpt-5-nano  ", True),
    ],
)
def test_reasoning_model_detection(model: str, reasoning: bool) -> None:
    assert is_reasoning_model(model) is reasoning
