from __future__ import annotations

import io
import wave
from time import perf_counter

import httpx
from app.stt.engine import StreamingSttEngine
from app.stt.providers.segmented import SpeechSegmenter

from stt_lab.audio import PcmAudio
from stt_lab.replay_backends import BackendMetadata, FinalOnlySegmentedEngine
from stt_lab.runners import Transcription


class VllmBackendSlot:
    """Own one HTTP client slot while the vLLM server owns the shared model."""

    def __init__(
        self,
        model_id: str,
        *,
        base_url: str,
        api_key: str | None,
        precision: str,
        timeout_seconds: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        client = httpx.Client(
            base_url=base_url.rstrip("/") + "/",
            headers=headers,
            timeout=httpx.Timeout(timeout_seconds, connect=min(5.0, timeout_seconds)),
            transport=transport,
        )
        self._runner = VllmTranscriber(client, model_id=model_id, precision=precision)
        self._loaded = False

    @property
    def metadata(self) -> BackendMetadata:
        return BackendMetadata(
            backend="vllm",
            model_id=self._runner.model_id,
            precision=self._runner.precision,
            output_mode="SEGMENT_FINAL_ONLY",
        )

    def load(self) -> None:
        if self._loaded:
            raise RuntimeError("vLLM backend slot is already loaded")
        self._runner.load()
        self._loaded = True

    def create_engine(self, segmenter: SpeechSegmenter) -> StreamingSttEngine:
        if not self._loaded:
            raise RuntimeError("vLLM backend slot is not loaded")
        return FinalOnlySegmentedEngine(
            provider="vllm",
            transcriber=self._runner,
            segmenter=segmenter,
        )

    def close(self) -> None:
        self._runner.close()
        self._loaded = False


class VllmTranscriber:
    def __init__(
        self,
        client: httpx.Client,
        *,
        model_id: str,
        precision: str,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._precision = precision

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def precision(self) -> str:
        return self._precision

    def load(self) -> None:
        response = self._client.get("models")
        response.raise_for_status()
        values = response.json().get("data", [])
        served_models = {
            item["id"]
            for item in values
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        if self._model_id not in served_models:
            raise ValueError(
                f"served model {self._model_id!r} is not in /models: {sorted(served_models)}"
            )

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        started = perf_counter()
        response = self._client.post(
            "audio/transcriptions",
            data={
                "model": self._model_id,
                "language": language.split("-", 1)[0],
                "response_format": "json",
                "temperature": "0",
                "seed": "0",
            },
            files={"file": ("segment.wav", _wav_payload(audio), "audio/wav")},
        )
        response.raise_for_status()
        text = response.json().get("text")
        if not isinstance(text, str):
            raise TypeError("vLLM response does not contain string field text")
        total_ms = (perf_counter() - started) * 1_000
        return Transcription(text.strip(), first_delta_ms=total_ms, total_ms=total_ms)

    def close(self) -> None:
        self._client.close()


def _wav_payload(audio: PcmAudio) -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(audio.sample_rate)
        wav.writeframes(audio.samples.astype("<i2", copy=False).tobytes())
    return target.getvalue()
