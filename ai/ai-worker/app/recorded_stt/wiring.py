from __future__ import annotations

from dataclasses import dataclass

from httpx import AsyncClient

from app.adapters.spring_hmac import SpringHmacSigner
from app.recorded_stt.caption_cues import CaptionCueAssembler
from app.recorded_stt.config import RecordedSttSettings
from app.recorded_stt.handler import RecordedSttJobHandler
from app.recorded_stt.media import FfmpegRecordedAudioProcessor
from app.recorded_stt.openai_whisper import OpenAIWhisperClient
from app.recorded_stt.rabbit_consumer import RabbitRecordedSttConsumer
from app.recorded_stt.spring_client import RecordedSttSpringClient
from app.runtime import WorkerRuntime, WorkerState


@dataclass(slots=True)
class RecordedSttResources:
    spring_client: AsyncClient
    openai_client: AsyncClient

    async def aclose(self) -> None:
        try:
            await self.spring_client.aclose()
        finally:
            await self.openai_client.aclose()


def build_recorded_stt_runtime(settings: RecordedSttSettings, state: WorkerState) -> WorkerRuntime:
    spring_http = AsyncClient(base_url=settings.spring_internal_base_url)
    openai_http = AsyncClient(base_url=settings.openai_base_url)
    resources = RecordedSttResources(spring_http, openai_http)
    spring = RecordedSttSpringClient(
        spring_http,
        SpringHmacSigner(settings.source_hmac_secret.get_secret_value()),
        SpringHmacSigner(settings.callback_hmac_secret.get_secret_value()),
        request_timeout_seconds=settings.spring_timeout_seconds,
        download_timeout_seconds=settings.source_download_timeout_seconds,
        source_max_bytes=settings.source_max_bytes,
    )
    whisper = OpenAIWhisperClient(
        openai_http,
        api_key=settings.openai_api_key.get_secret_value(),
        model=settings.model,
        language=settings.language,
        timeout_seconds=settings.request_timeout_seconds,
        retry_limit=settings.openai_retry_limit,
        retry_base_delay_seconds=settings.openai_retry_base_delay_seconds,
    )
    media = FfmpegRecordedAudioProcessor(
        ffmpeg_binary=settings.ffmpeg_binary,
        ffprobe_binary=settings.ffprobe_binary,
        chunk_seconds=settings.chunk_seconds,
        chunk_overlap_ms=settings.chunk_overlap_ms,
        chunk_max_bytes=settings.chunk_max_bytes,
        source_max_duration_ms=settings.source_max_duration_seconds * 1000,
    )
    handler = RecordedSttJobHandler(
        spring=spring,
        whisper=whisper,
        media=media,
        model=settings.model,
        language=settings.language,
        overlap_ms=settings.chunk_overlap_ms,
        cue_assembler=CaptionCueAssembler(
            max_duration_ms=settings.cue_max_duration_ms,
            max_chars=settings.cue_max_chars,
            pause_break_ms=settings.cue_pause_break_ms,
        ),
    )
    consumer = RabbitRecordedSttConsumer(
        settings.rabbitmq_url.get_secret_value(),
        handler,
        retry_limit=settings.rabbitmq_retry_limit,
        retry_base_delay_seconds=settings.rabbitmq_retry_base_delay_seconds,
        shutdown_grace_seconds=settings.shutdown_grace_seconds,
        on_ready=lambda ready: setattr(state, "ready", ready),
    )
    return WorkerRuntime(state, runner=consumer, close=resources.aclose)
