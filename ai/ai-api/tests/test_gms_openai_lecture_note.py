import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.adapters.gms_openai_lecture_note import GmsOpenAILectureNoteModel
from app.lecture_notes import LectureNoteDecisionAction, LectureNoteModelRequest


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


def test_v1_baseline_prompt_excludes_ignore_for_ab_evaluation() -> None:
    client = FakeClient(
        '{"action":"APPEND","topicTitle":"주제","keyPoints":["요점"]}'
    )
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
