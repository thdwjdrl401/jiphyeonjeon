from pathlib import Path

import httpx
import pytest

from app.recorded_stt.gms_whisper import GmsWhisperClient, WhisperTranscriptionError


async def test_calls_gms_whisper_verbose_json_without_logging_or_returning_raw_payload(tmp_path) -> None:
    chunk = tmp_path / "chunk.mp3"
    chunk.write_bytes(b"fake-mp3")

    async def endpoint(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/audio/transcriptions")
        assert request.headers["Authorization"] == "Bearer secret-key"
        body = await request.aread()
        assert b'whisper-1' in body
        assert b'verbose_json' in body
        return httpx.Response(
            200,
            json={
                "duration": 3.6,
                "segments": [{"start": 0.1, "end": 2.5, "text": "테스트"}],
                "text": "테스트",
            },
        )

    async with httpx.AsyncClient(
        base_url="https://api.openai.com/v1",
        transport=httpx.MockTransport(endpoint),
    ) as http:
        result = await GmsWhisperClient(
            http,
            api_key="secret-key",
            model="whisper-1",
            language="ko",
            timeout_seconds=30,
            retry_limit=0,
            retry_base_delay_seconds=0,
        ).transcribe(Path(chunk))

    assert result.duration == 3.6
    assert result.segments[0].text == "테스트"


async def test_maps_gms_400_to_permanent_model_unavailable(tmp_path) -> None:
    chunk = tmp_path / "chunk.mp3"
    chunk.write_bytes(b"fake-mp3")
    transport = httpx.MockTransport(lambda _request: httpx.Response(400, json={"error": "no model"}))
    async with httpx.AsyncClient(base_url="https://gms.invalid/v1", transport=transport) as http:
        client = GmsWhisperClient(
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
