from __future__ import annotations

import wave
from pathlib import Path

import httpx

from stt_lab.contracts import EvaluationClip
from stt_lab.vllm_benchmark import VllmTranscriptionClient, _run_concurrency


def _write_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(b"\x00\x00" * 16_000)


def _clip(path: Path) -> EvaluationClip:
    return EvaluationClip(
        clip_id="clip-1",
        audio_path=path,
        reference="정답 자막",
        training_reference="정답 자막",
        lecture_id="lecture-1",
        category="eng/comp",
        duration_ms=1_000,
        language="ko-KR",
        speaker_id="speaker-1",
        split="dev",
        terms=(),
        consent="AI-Hub-license",
    )


def test_vllm_client_uses_v1_transcription_endpoint_and_measures_results(
    tmp_path: Path,
) -> None:
    audio_path = tmp_path / "clip.wav"
    _write_wav(audio_path)
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/v1/models":
            return httpx.Response(
                200,
                json={"data": [{"id": "liveclass-whisper-large-v3"}]},
            )
        if request.url.path == "/v1/audio/transcriptions":
            return httpx.Response(200, json={"text": "정답 자막"})
        return httpx.Response(404)

    with httpx.Client(
        base_url="http://test/v1/",
        transport=httpx.MockTransport(handler),
    ) as http_client:
        client = VllmTranscriptionClient(
            client=http_client,
            model="liveclass-whisper-large-v3",
        )
        assert client.models() == ("liveclass-whisper-large-v3",)
        benchmark = _run_concurrency(
            client,
            (_clip(audio_path),),
            concurrency=2,
            repeats=2,
        )

    assert paths.count("/v1/audio/transcriptions") == 2
    assert benchmark["summary"]["successCount"] == 2
    assert benchmark["summary"]["failureCount"] == 0
    assert benchmark["summary"]["uniqueClipCount"] == 1
    assert benchmark["summary"]["meanNormalizedCer"] == 0
    assert benchmark["summary"]["meanLiteralNormalizedCer"] == 0


def test_vllm_benchmark_records_http_failures(tmp_path: Path) -> None:
    audio_path = tmp_path / "clip.wav"
    _write_wav(audio_path)

    with httpx.Client(
        base_url="http://test/v1/",
        transport=httpx.MockTransport(lambda request: httpx.Response(503)),
    ) as http_client:
        benchmark = _run_concurrency(
            VllmTranscriptionClient(client=http_client, model="model"),
            (_clip(audio_path),),
            concurrency=1,
            repeats=1,
        )

    assert benchmark["summary"]["successCount"] == 0
    assert benchmark["summary"]["failureCount"] == 1
    assert "HTTPStatusError" in benchmark["requests"][0]["error"]


def test_vllm_benchmark_records_invalid_wav_without_aborting_batch(tmp_path: Path) -> None:
    audio_path = tmp_path / "invalid.wav"
    audio_path.write_bytes(b"not-a-wav")

    with httpx.Client(
        base_url="http://test/v1/",
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
    ) as http_client:
        benchmark = _run_concurrency(
            VllmTranscriptionClient(client=http_client, model="model"),
            (_clip(audio_path),),
            concurrency=1,
            repeats=1,
        )

    assert benchmark["summary"]["successCount"] == 0
    assert benchmark["summary"]["failureCount"] == 1
    assert benchmark["requests"][0]["durationMs"] == 0
    assert "valid WAV" in benchmark["requests"][0]["error"]
