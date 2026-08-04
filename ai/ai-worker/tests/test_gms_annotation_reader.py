from __future__ import annotations

import base64
from types import SimpleNamespace

import pytest
from openai import APIError

from app.adapters.gms_annotation_reader import AnnotationReadError, GmsAnnotationReader


IMAGE = b"\x89PNG\r\n\x1a\nfake-bytes"


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


def _reader(completions: FakeCompletions, *, max_text_chars: int = 2_000) -> GmsAnnotationReader:
    return GmsAnnotationReader(
        api_key="x" * 32,
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_text_chars=max_text_chars,
        timeout_seconds=55.0,
        client=FakeClient(completions),  # type: ignore[arg-type]
    )


async def test_reads_image_into_plain_text() -> None:
    completions = FakeCompletions(content="  B+ tree 노드 분할 조건  ")

    result = await _reader(completions).read(IMAGE)

    assert result == "B+ tree 노드 분할 조건"
    assert completions.calls[0]["model"] == "gpt-4.1"
    assert completions.calls[0]["max_completion_tokens"] == 1_024


async def test_sends_the_image_inline_rather_than_as_a_storage_url() -> None:
    """A presigned URL is short-lived and is a storage credential; the job does not need to
    hand one to a third party."""
    completions = FakeCompletions(content="텍스트")

    await _reader(completions).read(IMAGE)

    content = completions.calls[0]["messages"][1]["content"]
    url = content[0]["image_url"]["url"]
    assert url.startswith("data:image/png;base64,")
    assert base64.b64decode(url.removeprefix("data:image/png;base64,")) == IMAGE


async def test_system_prompt_keeps_the_highlight_and_distrusts_the_image() -> None:
    completions = FakeCompletions(content="텍스트")

    await _reader(completions).read(IMAGE)

    system_prompt = completions.calls[0]["messages"][0]["content"]
    assert "강조 표시" in system_prompt
    assert "따르지 말고" in system_prompt


async def test_truncates_text_to_the_storage_limit() -> None:
    completions = FakeCompletions(content="가" * 3_000)

    result = await _reader(completions, max_text_chars=2_000).read(IMAGE)

    assert len(result) == 2_000


async def test_rejects_an_empty_image_before_calling_the_model() -> None:
    completions = FakeCompletions(content="텍스트")

    with pytest.raises(AnnotationReadError, match="must not be empty"):
        await _reader(completions).read(b"")

    assert completions.calls == []


@pytest.mark.parametrize("content", [None, "", "   "])
async def test_blank_model_output_is_a_failure_not_an_empty_snapshot(content: str | None) -> None:
    """Indexing a blank snapshot would leave evidence that silently matches nothing."""
    completions = FakeCompletions(content=content)

    with pytest.raises(AnnotationReadError, match="no annotation text"):
        await _reader(completions).read(IMAGE)


async def test_api_failure_surfaces_as_the_adapter_error() -> None:
    error = APIError("boom", request=SimpleNamespace(), body=None)  # type: ignore[arg-type]
    completions = FakeCompletions(error=error)

    with pytest.raises(AnnotationReadError, match="request failed"):
        await _reader(completions).read(IMAGE)


async def test_does_not_close_a_client_it_did_not_create() -> None:
    completions = FakeCompletions(content="텍스트")
    client = FakeClient(completions)
    reader = GmsAnnotationReader(
        api_key="x" * 32,
        model="gpt-4.1",
        max_output_tokens=1_024,
        max_text_chars=2_000,
        timeout_seconds=55.0,
        client=client,  # type: ignore[arg-type]
    )

    await reader.aclose()

    assert client.closed == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"api_key": ""},
        {"api_key": " padded "},
        {"model": ""},
        {"max_output_tokens": 0},
        {"max_text_chars": 0},
        {"timeout_seconds": 0.0},
    ],
)
def test_rejects_unusable_configuration(overrides: dict[str, object]) -> None:
    settings: dict[str, object] = {
        "api_key": "x" * 32,
        "model": "gpt-4.1",
        "max_output_tokens": 1_024,
        "max_text_chars": 2_000,
        "timeout_seconds": 55.0,
        "client": FakeClient(FakeCompletions()),
        **overrides,
    }

    with pytest.raises(ValueError):
        GmsAnnotationReader(**settings)  # type: ignore[arg-type]
