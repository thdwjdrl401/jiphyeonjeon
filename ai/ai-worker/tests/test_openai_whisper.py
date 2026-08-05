from pathlib import Path

import httpx
import pytest

from app.recorded_stt.openai_whisper import OpenAIWhisperClient, WhisperTranscriptionError


async def test_requests_openai_whisper_segment_and_word_timestamps(tmp_path) -> None:
    chunk = tmp_path / "chunk.mp3"
    chunk.write_bytes(b"fake-mp3")

    async def endpoint(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/audio/transcriptions"
        assert request.headers["Authorization"] == "Bearer secret-key"
        body = await request.aread()
        assert b"whisper-1" in body
        assert b"verbose_json" in body
        assert b"timestamp_granularities%5B%5D" not in body
        assert body.count(b"timestamp_granularities[]") == 2
        assert b"segment" in body
        assert b"word" in body
        return httpx.Response(
            200,
            json={
                "duration": 3.6,
                "text": "테스트 문장입니다.",
                "segments": [
                    {"start": 0.1, "end": 2.5, "text": "테스트 문장입니다."},
                ],
                "words": [
                    {"start": 0.1, "end": 0.8, "word": "테스트"},
                    {"start": 0.9, "end": 2.5, "word": " 문장입니다."},
                ],
            },
        )

    async with httpx.AsyncClient(
        base_url="https://api.openai.com/v1",
        transport=httpx.MockTransport(endpoint),
    ) as http:
        result = await OpenAIWhisperClient(
            http,
            api_key="secret-key",
            model="whisper-1",
            language="ko",
            timeout_seconds=30,
            retry_limit=0,
            retry_base_delay_seconds=0,
        ).transcribe(Path(chunk))

    assert result.duration == 3.6
    assert result.segments[0].text == "테스트 문장입니다."
    assert [word.word for word in result.words] == ["테스트", " 문장입니다."]
    assert result.words[1].start == 0.9
    assert result.words[1].end == 2.5


async def test_preserves_text_only_response_for_timestamp_fallback(tmp_path) -> None:
    chunk = tmp_path / "chunk.mp3"
    chunk.write_bytes(b"fake-mp3")
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            json={"duration": 3.6, "text": "한 덩어리", "segments": []},
        )
    )
    async with httpx.AsyncClient(base_url="https://api.openai.com/v1", transport=transport) as http:
        client = OpenAIWhisperClient(
            http,
            api_key="secret-key",
            model="whisper-1",
            language="ko",
            timeout_seconds=30,
            retry_limit=0,
            retry_base_delay_seconds=0,
        )
        result = await client.transcribe(chunk)

    assert result.text == "한 덩어리"
    assert result.segments == ()
    assert result.words == ()


async def test_preserves_zero_duration_word_for_normalization(tmp_path) -> None:
    chunk = tmp_path / "chunk.mp3"
    chunk.write_bytes(b"fake-mp3")
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            json={
                "duration": 3.6,
                "text": "이 영상은",
                "words": [
                    {"start": 1.0, "end": 1.0, "word": "이"},
                    {"start": 1.0, "end": 2.0, "word": "영상은"},
                ],
            },
        )
    )
    async with httpx.AsyncClient(base_url="https://api.openai.com/v1", transport=transport) as http:
        result = await OpenAIWhisperClient(
            http,
            api_key="secret-key",
            model="whisper-1",
            language="ko",
            timeout_seconds=30,
            retry_limit=0,
            retry_base_delay_seconds=0,
        ).transcribe(chunk)

    assert result.words[0].start == result.words[0].end == 1.0


async def test_maps_openai_400_to_permanent_model_unavailable(tmp_path) -> None:
    chunk = tmp_path / "chunk.mp3"
    chunk.write_bytes(b"fake-mp3")
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(400, json={"error": "invalid request"})
    )
    async with httpx.AsyncClient(base_url="https://api.openai.com/v1", transport=transport) as http:
        client = OpenAIWhisperClient(
            http,
            api_key="secret-key",
            model="whisper-1",
            language="ko",
            timeout_seconds=30,
            retry_limit=0,
            retry_base_delay_seconds=0,
        )
        with pytest.raises(WhisperTranscriptionError) as captured:
            await client.transcribe(chunk)

    assert captured.value.code == "STT_MODEL_UNAVAILABLE"
    assert captured.value.retryable is False
