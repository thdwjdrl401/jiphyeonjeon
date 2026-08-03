from __future__ import annotations

from collections.abc import Callable
from typing import cast

from app.config import Settings
from app.stt.nemotron_asr import NemotronStreamingASR
from app.stt.providers.nemotron import NemotronRecognizer, NemotronStreamingEngine
from app.stt.providers.openai_realtime import OpenAiRealtimeStreamingEngine
from app.stt.providers.stub import StubStreamingEngine
from app.stt.providers.vllm_whisper import (
    VllmWhisperRuntimeConfiguration,
    VllmWhisperStreamingEngine,
    probe_vllm_whisper_runtime,
    vllm_whisper_runtime_is_ready,
)
from app.stt.registry import SttEngineRegistry, SttProviderExecutionProfile

_NEMOTRON_MAX_ACTIVE_JOBS = 12
_NEMOTRON_DEFAULT_IDLE_PROCESSES = 12
_NEMOTRON_INITIALIZE_TIMEOUT_SECONDS = 120.0
_NEMOTRON_JOB_MEMORY_WARN_MB = 2304.0
_VLLM_WHISPER_MAX_ACTIVE_JOBS = 1
_VLLM_WHISPER_INITIALIZE_TIMEOUT_SECONDS = 30.0
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
    registry.register(
        "vllm-whisper",
        lambda: VllmWhisperStreamingEngine(_vllm_whisper_configuration(settings)),
        execution_profile=SttProviderExecutionProfile(
            max_active_jobs=_VLLM_WHISPER_MAX_ACTIVE_JOBS,
            default_max_active_jobs=1,
            default_num_idle_processes=1,
            initialize_process_timeout_seconds=_VLLM_WHISPER_INITIALIZE_TIMEOUT_SECONDS,
            job_memory_warn_mb=1000.0,
        ),
        validate=lambda: _vllm_whisper_configuration(settings).validate(),
        process_resource_factory=lambda: _prewarm_vllm_whisper(settings),
        prewarmed_engine_factory=lambda resource: VllmWhisperStreamingEngine(
            cast(VllmWhisperRuntimeConfiguration, resource)
        ),
    )
    return registry


def build_stt_provider_readiness_probe(settings: Settings) -> Callable[[], bool] | None:
    """Return a live runtime probe only for providers with an external model owner."""

    if settings.stt_provider.strip().lower() != "vllm-whisper":
        return None
    configuration = _vllm_whisper_configuration(settings)
    return lambda: vllm_whisper_runtime_is_ready(configuration)


def _vllm_whisper_configuration(settings: Settings) -> VllmWhisperRuntimeConfiguration:
    return VllmWhisperRuntimeConfiguration(
        base_url=settings.vllm_whisper_base_url,
        model=settings.vllm_whisper_model,
        api_key=settings.vllm_api_key,
        request_timeout_seconds=settings.vllm_whisper_request_timeout_seconds,
        connect_timeout_seconds=settings.vllm_whisper_connect_timeout_seconds,
    )


def _prewarm_vllm_whisper(settings: Settings) -> VllmWhisperRuntimeConfiguration:
    configuration = _vllm_whisper_configuration(settings)
    probe_vllm_whisper_runtime(configuration)
    return configuration


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
