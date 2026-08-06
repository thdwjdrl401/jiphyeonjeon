from __future__ import annotations

import io
import json
import logging
import math
import wave
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

from app.audio.segmentation import SpeechSegment
from app.stt.engine import EngineCapabilities, SttStreamContext, SttStreamStarted
from app.stt.providers.segmented import (
    ProviderSegmentFinal,
    SegmentedStreamingEngine,
    SpeechSegmenter,
)

logger = logging.getLogger(__name__)

_NORMAL_FINISH_REASON = "stop"
_MIN_REPEATED_COPIES = 4
_MAX_REPEATED_UNIT_CHARS = 24
_MIN_REPEATED_SPAN_CHARS = 8
_MIN_REPEATED_SHARE = 0.6


@dataclass(frozen=True, slots=True)
class VllmWhisperRuntimeConfiguration:
    base_url: str
    model: str
    api_key: str = field(default="", repr=False)
    request_timeout_seconds: float = 20.0
    connect_timeout_seconds: float = 2.0

    def validate(self) -> None:
        parsed = urlsplit(self.base_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") != "/v1"
        ):
            raise RuntimeError("VLLM_WHISPER_BASE_URL must be a loopback HTTP URL ending in /v1")
        try:
            port = parsed.port
        except ValueError as exc:
            raise RuntimeError("VLLM_WHISPER_BASE_URL must contain a valid port") from exc
        if port is None:
            raise RuntimeError("VLLM_WHISPER_BASE_URL must contain an explicit port")
        if not self.model.strip() or len(self.model) > 256:
            raise RuntimeError("VLLM_WHISPER_MODEL must contain 1-256 characters")
        for name, value in (
            ("VLLM_WHISPER_REQUEST_TIMEOUT_SECONDS", self.request_timeout_seconds),
            ("VLLM_WHISPER_CONNECT_TIMEOUT_SECONDS", self.connect_timeout_seconds),
        ):
            if isinstance(value, bool) or not isinstance(value, int | float):
                raise TypeError(f"{name} must be a finite positive number")
            if not math.isfinite(value) or value <= 0:
                raise RuntimeError(f"{name} must be a finite positive number")
        if self.connect_timeout_seconds > self.request_timeout_seconds:
            raise RuntimeError(
                "VLLM_WHISPER_CONNECT_TIMEOUT_SECONDS must not exceed "
                "VLLM_WHISPER_REQUEST_TIMEOUT_SECONDS"
            )


def probe_vllm_whisper_runtime(
    configuration: VllmWhisperRuntimeConfiguration,
    *,
    transport: httpx.BaseTransport | None = None,
) -> None:
    configuration.validate()
    with _sync_client(configuration, transport=transport) as client:
        response = client.get("models")
        response.raise_for_status()
        served_models = _served_model_ids(response.json())
    if configuration.model not in served_models:
        raise RuntimeError(
            f"served model {configuration.model!r} is not in /models: {sorted(served_models)}"
        )


def vllm_whisper_runtime_is_ready(
    configuration: VllmWhisperRuntimeConfiguration,
) -> bool:
    try:
        probe_vllm_whisper_runtime(configuration)
    except (OSError, RuntimeError, TypeError, ValueError, httpx.HTTPError):
        return False
    return True


class VllmWhisperStreamingEngine(SegmentedStreamingEngine):
    """Submit common VAD segments to a loopback vLLM Whisper runtime."""

    def __init__(
        self,
        configuration: VllmWhisperRuntimeConfiguration,
        *,
        segmenter: SpeechSegmenter | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        configuration.validate()
        super().__init__("vllm-whisper", segmenter=segmenter)
        headers = (
            {"Authorization": f"Bearer {configuration.api_key}"} if configuration.api_key else {}
        )
        self._configuration = configuration
        self._client = httpx.AsyncClient(
            base_url=configuration.base_url.rstrip("/") + "/",
            headers=headers,
            timeout=httpx.Timeout(
                configuration.request_timeout_seconds,
                connect=configuration.connect_timeout_seconds,
            ),
            transport=transport,
            trust_env=False,
        )

    @property
    def capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(sample_rate=16_000, num_channels=1, incremental_deltas=False)

    async def start_stream(self, context: SttStreamContext) -> SttStreamStarted:
        response = await self._client.get("models")
        response.raise_for_status()
        served_models = _served_model_ids(response.json())
        if self._configuration.model not in served_models:
            raise RuntimeError(
                f"served model {self._configuration.model!r} is not in /models: "
                f"{sorted(served_models)}"
            )
        return await super().start_stream(context)

    async def _transcribe(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> AsyncIterator[str | ProviderSegmentFinal]:
        parts: list[str] = []
        finish_reason: str | None = None
        async with self._client.stream(
            "POST",
            "audio/transcriptions",
            data={
                "model": self._configuration.model,
                "language": context.language.split("-", 1)[0],
                "response_format": "json",
                "temperature": "0",
                "seed": "0",
                "stream": "true",
            },
            files={"file": ("segment.wav", _wav_payload(segment), "audio/wav")},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line.removeprefix("data: ")
                if data == "[DONE]":
                    break
                content, event_finish_reason = _transcription_stream_event(data)
                parts.append(content)
                if event_finish_reason is not None:
                    finish_reason = event_finish_reason

        text = "".join(parts).strip()
        if text.startswith("language ") and "<asr_text>" in text:
            text = text.split("<asr_text>", 1)[1]
        text = text.strip()
        if finish_reason != _NORMAL_FINISH_REASON:
            logger.warning(
                "suppressed Whisper transcription without EOS completion: "
                "finish_reason=%s segment_duration_ms=%d",
                finish_reason,
                segment.end_ms - segment.start_ms,
            )
            return
        if _is_pathologically_repetitive(text):
            logger.warning(
                "suppressed pathologically repetitive Whisper transcription: "
                "segment_duration_ms=%d output_chars=%d",
                segment.end_ms - segment.start_ms,
                len(text),
            )
            return
        yield ProviderSegmentFinal(text)

    async def _close_provider(self) -> None:
        await self._client.aclose()


def _sync_client(
    configuration: VllmWhisperRuntimeConfiguration,
    *,
    transport: httpx.BaseTransport | None,
) -> httpx.Client:
    headers = {"Authorization": f"Bearer {configuration.api_key}"} if configuration.api_key else {}
    return httpx.Client(
        base_url=configuration.base_url.rstrip("/") + "/",
        headers=headers,
        timeout=httpx.Timeout(
            configuration.request_timeout_seconds,
            connect=configuration.connect_timeout_seconds,
        ),
        transport=transport,
        trust_env=False,
    )


def _served_model_ids(payload: object) -> set[str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise TypeError("vLLM /models response does not contain list field data")
    return {
        item["id"]
        for item in payload["data"]
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def _transcription_stream_event(data: str) -> tuple[str, str | None]:
    payload = json.loads(data)
    if not isinstance(payload, dict):
        raise TypeError("vLLM transcription stream event must be an object")
    choices = payload.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        raise TypeError("vLLM transcription stream event must contain one choice")
    choice = choices[0]
    delta = choice.get("delta")
    if not isinstance(delta, dict):
        raise TypeError("vLLM transcription stream choice must contain a delta")
    content = delta.get("content", "")
    if not isinstance(content, str):
        raise TypeError("vLLM transcription stream delta content must be a string")
    finish_reason = choice.get("finish_reason")
    if finish_reason is not None and not isinstance(finish_reason, str):
        raise TypeError("vLLM transcription finish_reason must be a string or null")
    return content, finish_reason


def _is_pathologically_repetitive(text: str) -> bool:
    compact = " ".join(text.split())
    text_length = len(compact)
    if text_length < _MIN_REPEATED_SPAN_CHARS:
        return False

    maximum_unit = min(_MAX_REPEATED_UNIT_CHARS, text_length // _MIN_REPEATED_COPIES)
    required_span = max(
        _MIN_REPEATED_SPAN_CHARS,
        int(text_length * _MIN_REPEATED_SHARE),
    )
    for start in range(text_length):
        for unit_length in range(1, maximum_unit + 1):
            unit_end = start + unit_length
            if unit_end > text_length:
                break
            unit = compact[start:unit_end]
            copies = 1
            cursor = unit_end
            while compact.startswith(unit, cursor):
                copies += 1
                cursor += unit_length
            if copies >= _MIN_REPEATED_COPIES and copies * unit_length >= required_span:
                return True
    return False


def _wav_payload(segment: SpeechSegment) -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(segment.sample_rate)
        output.writeframes(segment.pcm)
    return target.getvalue()
