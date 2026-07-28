from __future__ import annotations

from typing import cast

from app.config import Settings
from app.stt.nemotron_asr import NemotronStreamingASR
from app.stt.providers.nemotron import NemotronRecognizer, NemotronStreamingEngine
from app.stt.providers.openai_realtime import OpenAiRealtimeStreamingEngine
from app.stt.providers.stub import StubStreamingEngine
from app.stt.registry import SttEngineRegistry, SttProviderExecutionProfile

_NEMOTRON_MAX_ACTIVE_JOBS = 12
_NEMOTRON_DEFAULT_IDLE_PROCESSES = 12
_NEMOTRON_INITIALIZE_TIMEOUT_SECONDS = 120.0
_NEMOTRON_JOB_MEMORY_WARN_MB = 2304.0
_OPENAI_REALTIME_DELAYS = frozenset({"minimal", "low", "medium", "high", "xhigh"})


def build_stt_provider_registry(settings: Settings) -> SttEngineRegistry:
    """Build the provider catalog without constructing an engine or GPU model."""

    registry = SttEngineRegistry()
    registry.register("stub", StubStreamingEngine)
    registry.register(
        "openai-realtime",
        lambda: OpenAiRealtimeStreamingEngine(
            settings.openai_api_key,
            settings.openai_realtime_model,
            delay=settings.openai_realtime_delay,
        ),
        validate=lambda: _validate_openai_realtime(settings),
    )
    registry.register(
        "nemotron",
        lambda: NemotronStreamingEngine(
            settings.nemotron_model_id,
            settings.asr_language,
        ),
        execution_profile=SttProviderExecutionProfile(
            max_active_jobs=_NEMOTRON_MAX_ACTIVE_JOBS,
            default_max_active_jobs=_NEMOTRON_MAX_ACTIVE_JOBS,
            default_num_idle_processes=_NEMOTRON_DEFAULT_IDLE_PROCESSES,
            initialize_process_timeout_seconds=_NEMOTRON_INITIALIZE_TIMEOUT_SECONDS,
            job_memory_warn_mb=_NEMOTRON_JOB_MEMORY_WARN_MB,
        ),
        validate=lambda: _validate_nemotron(settings),
        process_resource_factory=lambda: _load_nemotron_recognizer(settings),
        prewarmed_engine_factory=lambda resource: NemotronStreamingEngine(
            settings.nemotron_model_id,
            settings.asr_language,
            prewarmed_recognizer=cast(NemotronRecognizer, resource),
        ),
    )
    return registry


def _validate_openai_realtime(settings: Settings) -> None:
    if not settings.openai_api_key.strip():
        raise RuntimeError("OPENAI_API_KEY is required for openai-realtime")
    if not settings.openai_realtime_model.strip():
        raise RuntimeError("OPENAI_REALTIME_TRANSCRIPTION_MODEL must not be blank")
    if settings.openai_realtime_delay not in _OPENAI_REALTIME_DELAYS:
        raise RuntimeError("OPENAI_REALTIME_TRANSCRIPTION_DELAY is invalid")


def _validate_nemotron(settings: Settings) -> None:
    if not settings.nemotron_model_id.strip():
        raise RuntimeError("ASR_MODEL_ID must not be blank for nemotron")


def _load_nemotron_recognizer(settings: Settings) -> NemotronStreamingASR:
    recognizer = NemotronStreamingASR(settings.nemotron_model_id, settings.asr_language)
    try:
        recognizer.load()
    except BaseException:
        recognizer.close()
        raise
    return recognizer
