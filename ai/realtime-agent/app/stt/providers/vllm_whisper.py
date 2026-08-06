from __future__ import annotations

import io
import json
import logging
import math
import unicodedata
import wave
import zlib
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

from app.audio.segmentation import SpeechSegment, VadSegmenter
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
_MAX_COMPRESSION_RATIO = 2.4
_MAX_CHARACTERS_PER_SECOND = 8.0


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

    # vLLM's Whisper endpoint reports why generation stopped only over its
    # transcription SSE stream, and that terminal reason is what separates a normal
    # EOS from a run that hit the token limit. A runtime that answers with one
    # complete JSON transcript has no such signal and must not be gated on it.
    _uses_streaming_transcription = True

    # Repetition, compression and output-rate thresholds were calibrated against
    # Whisper's non-speech hallucinations. Another model has to earn its own
    # thresholds from its own evaluation before being judged by these.
    _applies_hallucination_gates = True

    def __init__(
        self,
        configuration: VllmWhisperRuntimeConfiguration,
        *,
        segmenter: SpeechSegmenter | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        configuration.validate()
        whisper_segmenter = segmenter or VadSegmenter(
            activation_ms=120,
            min_speech_ms=900,
            min_speech_ratio=0.5,
            silence_close_ms=700,
        )
        super().__init__("vllm-whisper", segmenter=whisper_segmenter)
        headers = (
            {"Authorization": f"Bearer {configuration.api_key}"} if configuration.api_key else {}
        )
        self._configuration = configuration
        self._last_final_key: str | None = None
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
        if self._uses_streaming_transcription:
            text, finish_reason = await self._streamed_transcript(segment, context)
        else:
            text, finish_reason = await self._complete_transcript(segment, context)

        text = text.strip()
        if text.startswith("language ") and "<asr_text>" in text:
            text = text.split("<asr_text>", 1)[1]
        text = text.strip()
        compression_ratio = _compression_ratio(text)
        characters_per_second = _characters_per_second(text, segment)
        gate = None
        if finish_reason != _NORMAL_FINISH_REASON:
            gate = "FINISH_REASON"
        elif not text:
            gate = "EMPTY"
        elif not self._applies_hallucination_gates:
            gate = None
        elif _is_pathologically_repetitive(text):
            gate = "REPEATED_SPAN"
        elif compression_ratio > _MAX_COMPRESSION_RATIO:
            gate = "COMPRESSION_RATIO"
        elif characters_per_second > _MAX_CHARACTERS_PER_SECOND:
            gate = "OUTPUT_RATE"
        else:
            final_key = _final_key(text)
            if final_key and final_key == self._last_final_key:
                gate = "CONSECUTIVE_DUPLICATE"

        if gate is not None:
            logger.warning(
                "suppressed Whisper transcription: gate=%s finish_reason=%s "
                "speech_ms=%d segment_ms=%d speech_ratio=%.4f mean_rms_dbfs=%.2f "
                "text_len=%d compression_ratio=%.4f characters_per_second=%.4f",
                gate,
                finish_reason,
                segment.speech_ms,
                segment.segment_ms,
                segment.speech_ratio,
                segment.mean_rms_dbfs,
                len(text),
                compression_ratio,
                characters_per_second,
            )
            return
        self._last_final_key = _final_key(text)
        logger.info(
            "accepted Whisper transcription: finish_reason=%s speech_ms=%d "
            "segment_ms=%d speech_ratio=%.4f mean_rms_dbfs=%.2f text_len=%d "
            "compression_ratio=%.4f characters_per_second=%.4f",
            finish_reason,
            segment.speech_ms,
            segment.segment_ms,
            segment.speech_ratio,
            segment.mean_rms_dbfs,
            len(text),
            compression_ratio,
            characters_per_second,
        )
        yield ProviderSegmentFinal(text)

    async def _streamed_transcript(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> tuple[str, str | None]:
        parts: list[str] = []
        finish_reason: str | None = None
        async with self._client.stream(
            "POST",
            "audio/transcriptions",
            data=self._request_data(context) | {"stream": "true"},
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
        return "".join(parts), finish_reason

    async def _complete_transcript(
        self,
        segment: SpeechSegment,
        context: SttStreamContext,
    ) -> tuple[str, str | None]:
        """Read one complete transcript. A whole answer is by definition a normal EOS."""

        response = await self._client.post(
            "audio/transcriptions",
            data=self._request_data(context),
            files={"file": ("segment.wav", _wav_payload(segment), "audio/wav")},
        )
        response.raise_for_status()
        text = response.json().get("text")
        if not isinstance(text, str):
            raise TypeError("transcription response does not contain string field text")
        return text, _NORMAL_FINISH_REASON

    def _request_data(self, context: SttStreamContext) -> dict[str, str]:
        return {
            "model": self._configuration.model,
            "language": context.language.split("-", 1)[0],
            "response_format": "json",
            "temperature": "0",
            "seed": "0",
        }

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


def _compression_ratio(text: str) -> float:
    encoded = text.encode("utf-8")
    if not encoded:
        return 0.0
    return len(encoded) / len(zlib.compress(encoded))


def _characters_per_second(text: str, segment: SpeechSegment) -> float:
    audio_duration_ms = max(
        segment.segment_ms or segment.end_ms - segment.start_ms,
        1,
    )
    character_count = sum(not character.isspace() for character in text)
    return character_count * 1_000 / audio_duration_ms


def _final_key(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        character
        for character in normalized
        if not character.isspace() and not unicodedata.category(character).startswith("P")
    )


def _wav_payload(segment: SpeechSegment) -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(segment.sample_rate)
        output.writeframes(segment.pcm)
    return target.getvalue()
