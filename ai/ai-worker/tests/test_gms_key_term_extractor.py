from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from openai import APIError

from app.adapters.gms_key_term_extractor import GmsKeyTermExtractor, KeyTermExtractionError
from app.ingestion.models import KeyTerm


class FakeCompletions:
    def __init__(self, *, content: str | None = None, error: BaseException | None = None) -> None:
        self.content = content
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        choice = SimpleNamespace(message=SimpleNamespace(content=self.content))
        return SimpleNamespace(choices=[choice] if self.content is not None else [])


class FakeClient:
    def __init__(self, completions: FakeCompletions) -> None:
        self.chat = SimpleNamespace(completions=completions)
        self.closed = 0

    async def close(self) -> None:
        self.closed += 1


def _extractor(completions: FakeCompletions) -> GmsKeyTermExtractor:
    return GmsKeyTermExtractor(
        api_key="x" * 32,
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_prompt_chars=100_000,
        timeout_seconds=55.0,
        client=FakeClient(completions),  # type: ignore[arg-type]
    )


async def test_extracts_terms_from_structured_json_response() -> None:
    payload = json.dumps(
        {"terms": [{"term": "지도학습", "definition": "정답이 있는 데이터로 학습"}]}
    )
    completions = FakeCompletions(content=payload)

    result = await _extractor(completions).extract("슬라이드 텍스트")

    assert result == (KeyTerm(term="지도학습", definition="정답이 있는 데이터로 학습"),)
    assert completions.calls[0]["model"] == "gpt-4.1"
    assert completions.calls[0]["max_tokens"] == 1_024
    assert completions.calls[0]["response_format"]["type"] == "json_schema"


async def test_empty_text_short_circuits_without_a_request() -> None:
    completions = FakeCompletions(content="{}")

    result = await _extractor(completions).extract("   ")

    assert result == ()
    assert completions.calls == []


async def test_truncates_prompt_to_max_prompt_chars() -> None:
    completions = FakeCompletions(content=json.dumps({"terms": []}))
    extractor = GmsKeyTermExtractor(
        api_key="x" * 32,
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_prompt_chars=5,
        timeout_seconds=55.0,
        client=FakeClient(completions),  # type: ignore[arg-type]
    )

    await extractor.extract("0123456789")

    sent_prompt = completions.calls[0]["messages"][1]["content"]
    assert sent_prompt == "01234"


def test_rejects_blank_or_padded_api_key() -> None:
    with pytest.raises(ValueError, match="API key"):
        GmsKeyTermExtractor(
            api_key=" x",
            model="gpt-4.1",
            max_output_tokens=1_024,
            max_prompt_chars=100_000,
            timeout_seconds=55.0,
        )


async def test_api_error_is_wrapped_in_key_term_extraction_error() -> None:
    completions = FakeCompletions(error=APIError("boom", request=object(), body=None))

    with pytest.raises(KeyTermExtractionError):
        await _extractor(completions).extract("text")


@pytest.mark.parametrize(
    "content",
    [
        None,
        "not json",
        json.dumps({"wrong_key": []}),
        json.dumps({"terms": [{"term": "only"}]}),
    ],
)
async def test_malformed_response_is_rejected(content: str | None) -> None:
    completions = FakeCompletions(content=content)

    with pytest.raises(KeyTermExtractionError):
        await _extractor(completions).extract("text")


async def test_aclose_closes_an_internally_created_client_but_not_an_injected_one() -> None:
    injected_completions = FakeCompletions(content=json.dumps({"terms": []}))
    injected_client = FakeClient(injected_completions)
    injected_extractor = GmsKeyTermExtractor(
        api_key="x" * 32,
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_prompt_chars=100_000,
        timeout_seconds=55.0,
        client=injected_client,  # type: ignore[arg-type]
    )

    await injected_extractor.aclose()

    assert injected_client.closed == 0


async def test_aclose_closes_a_client_it_created_itself(monkeypatch) -> None:
    internal_completions = FakeCompletions(content=json.dumps({"terms": []}))
    internal_client = FakeClient(internal_completions)
    monkeypatch.setattr(
        "app.adapters.gms_key_term_extractor.AsyncOpenAI",
        lambda **_kwargs: internal_client,
    )

    extractor = GmsKeyTermExtractor(
        api_key="x" * 32,
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_prompt_chars=100_000,
        timeout_seconds=55.0,
    )
    await extractor.aclose()

    assert internal_client.closed == 1
