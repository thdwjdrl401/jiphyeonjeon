from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
import numpy as np
from app.audio.segmentation import SpeechSegment
from app.stt.engine import EngineCapabilities, StreamingSttEngine, SttStreamContext
from app.stt.providers.segmented import (
    ProviderSegmentFinal,
    SegmentedStreamingEngine,
    SpeechSegmenter,
)

from stt_lab.replay_backends import BackendMetadata


@dataclass(frozen=True, slots=True)
class QwenVllmStreamingConfiguration:
    base_url: str
    chunk_ms: int = 500
    timeout_seconds: float = 120.0

    def __post_init__(self) -> None:
        parsed = urlsplit(self.base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Qwen streaming server must use a loopback HTTP origin")
        if parsed.port is None:
            raise ValueError("Qwen streaming server URL must include an explicit port")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError(
                "Qwen streaming server URL must not include a path, query, or fragment"
            )
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Qwen streaming server URL must not include credentials")
        if self.chunk_ms <= 0:
            raise ValueError("Qwen streaming chunk_ms must be positive")
        if self.timeout_seconds <= 0:
            raise ValueError("Qwen streaming timeout_seconds must be positive")

    @property
    def client_base_url(self) -> str:
        return self.base_url.rstrip("/") + "/"


class QwenVllmStreamingBackendSlot:
    """Own lightweight HTTP clients while the external vLLM process owns the model."""

    def __init__(
        self,
        model_id: str,
        *,
        configuration: QwenVllmStreamingConfiguration,
        precision: str,
        transport: httpx.MockTransport | None = None,
    ) -> None:
        if not model_id.strip():
            raise ValueError("Qwen model_id must not be blank")
        self._model_id = model_id
        self._configuration = configuration
        self._precision = precision
        self._transport = transport
        self._loaded = False

    @property
    def metadata(self) -> BackendMetadata:
        return BackendMetadata(
            backend="qwen-vllm-streaming",
            model_id=self._model_id,
            precision=self._precision,
            output_mode="INCREMENTAL",
        )

    def load(self) -> None:
        if self._loaded:
            raise RuntimeError("Qwen streaming backend slot is already loaded")
        with httpx.Client(
            base_url=self._configuration.client_base_url,
            timeout=_timeout(self._configuration.timeout_seconds),
            transport=self._transport,
        ) as client:
            response = client.get("")
            response.raise_for_status()
        self._loaded = True

    def create_engine(self, segmenter: SpeechSegmenter) -> StreamingSttEngine:
        if not self._loaded:
            raise RuntimeError("Qwen streaming backend slot is not loaded")
        client = httpx.AsyncClient(
            base_url=self._configuration.client_base_url,
            timeout=_timeout(self._configuration.timeout_seconds),
            transport=self._transport,
        )
        return QwenVllmStreamingEngine(
            client=client,
            chunk_ms=self._configuration.chunk_ms,
            segmenter=segmenter,
        )

    def close(self) -> None:
        self._loaded = False


class QwenVllmStreamingEngine(SegmentedStreamingEngine):
    """Replay product VAD segments through Qwen's official vLLM streaming protocol."""

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        chunk_ms: int,
        segmenter: SpeechSegmenter,
    ) -> None:
        super().__init__("qwen-vllm-streaming", segmenter=segmenter)
        self._client = client
        self._chunk_ms = chunk_ms

    @property
    def capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(sample_rate=16_000, num_channels=1, incremental_deltas=True)

    async def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[str | ProviderSegmentFinal]:
        del context
        session_id = await self._start_session()
        finished = False
        previous_text = ""
        try:
            samples = np.frombuffer(segment.pcm, dtype="<i2").astype("<f4")
            samples /= 32768.0
            chunk_samples = max(1, segment.sample_rate * self._chunk_ms // 1_000)
            for offset in range(0, samples.size, chunk_samples):
                response = await self._client.post(
                    "api/chunk",
                    params={"session_id": session_id},
                    content=samples[offset : offset + chunk_samples].tobytes(),
                    headers={"Content-Type": "application/octet-stream"},
                )
                response.raise_for_status()
                cumulative_text = _response_text(response).strip()
                if cumulative_text.startswith(previous_text):
                    delta = cumulative_text[len(previous_text) :]
                    if delta:
                        yield delta
                previous_text = cumulative_text

            response = await self._client.post(
                "api/finish",
                params={"session_id": session_id},
            )
            response.raise_for_status()
            finished = True
            final_text = _response_text(response).strip()
            if final_text:
                yield ProviderSegmentFinal(final_text)
        finally:
            if not finished:
                await self._finish_best_effort(session_id)

    async def _start_session(self) -> str:
        response = await self._client.post("api/start")
        response.raise_for_status()
        payload = response.json()
        session_id = payload.get("session_id") if isinstance(payload, dict) else None
        if not isinstance(session_id, str) or not session_id.strip():
            raise TypeError("Qwen start response does not contain string field session_id")
        return session_id

    async def _finish_best_effort(self, session_id: str) -> None:
        try:
            await self._client.post(
                "api/finish",
                params={"session_id": session_id},
            )
        except httpx.HTTPError:
            return

    async def _close_provider(self) -> None:
        await self._client.aclose()


def _response_text(response: httpx.Response) -> str:
    payload = response.json()
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str):
        raise TypeError("Qwen streaming response does not contain string field text")
    return text


def _timeout(seconds: float) -> httpx.Timeout:
    return httpx.Timeout(seconds, connect=min(5.0, seconds))
