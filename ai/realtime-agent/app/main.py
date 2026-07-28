from __future__ import annotations

from collections.abc import Callable
from functools import partial

from livekit.agents import AgentServer, JobContext, cli
from redis.asyncio import Redis

from app.adapters.redis_caption_publisher import RedisCaptionPublisher
from app.adapters.redis_session_lease import RedisSessionLease
from app.adapters.spring_status_callback import SpringStatusCallback
from app.config import Settings
from app.jobs.dispatched_room_job import run_dispatched_room_job
from app.jobs.lifecycle import DisabledLifecycleReporter, LifecycleReporter
from app.jobs.metadata import JobMetadata
from app.livekit.audio_source import LiveKitInstructorAudioSource
from app.livekit.rtc_config import build_turn_rtc_config
from app.stt.providers.nemotron import NemotronStreamingEngine
from app.stt.providers.openai_realtime import OpenAiRealtimeStreamingEngine
from app.stt.providers.stub import StubStreamingEngine
from app.stt.registry import SttEngineRegistry

_LOAD_THRESHOLD = 1.0


def build_engine_registry(settings: Settings) -> SttEngineRegistry:
    registry = SttEngineRegistry()
    registry.register("stub", StubStreamingEngine)
    registry.register(
        "openai-realtime",
        lambda: OpenAiRealtimeStreamingEngine(
            settings.openai_api_key,
            settings.openai_realtime_model,
            delay=settings.openai_realtime_delay,
        ),
    )
    registry.register(
        "nemotron",
        lambda: NemotronStreamingEngine(
            settings.nemotron_model_id,
            settings.asr_language,
        ),
    )
    return registry


def build_lifecycle_reporter(
    settings: Settings,
    metadata: JobMetadata,
    job_id: str,
) -> LifecycleReporter:
    if not settings.spring_status_callback_enabled:
        return DisabledLifecycleReporter()
    return SpringStatusCallback(
        settings.spring_status_callback_url,
        settings.spring_status_callback_secret,
        metadata.session_id,
        metadata.lesson_id,
        job_id,
        metadata.correlation_id,
        timeout_seconds=settings.spring_status_callback_timeout_seconds,
        max_attempts=settings.spring_status_callback_attempts,
    )


def _build_active_job_load(max_active_jobs: int) -> Callable[[AgentServer], float]:
    if max_active_jobs < 1:
        raise ValueError("max_active_jobs must be positive")

    def active_job_load(server: AgentServer) -> float:
        return min(len(server.active_jobs) / max_active_jobs, _LOAD_THRESHOLD)

    return active_job_load


def build_agent_server(settings: Settings) -> AgentServer:
    server = AgentServer(
        ws_url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        load_fnc=_build_active_job_load(settings.max_active_jobs),
        load_threshold=_LOAD_THRESHOLD,
        # One warm executor keeps startup reservation conservative without prewarming
        # STT_MAX_ACTIVE_JOBS process/thread runners. Once a job is active, the SDK derives
        # each reserved slot from active/max_active_jobs exactly.
        num_idle_processes=1,
    )
    entrypoint = partial(_run_agent_job, settings=settings)
    server.rtc_session(entrypoint, agent_name=settings.agent_name)
    return server


async def _run_agent_job(context: JobContext, *, settings: Settings) -> None:
    registry = build_engine_registry(settings)
    rtc_config = build_turn_rtc_config(
        settings.livekit_turn_url,
        settings.livekit_turn_secret,
    )
    redis = Redis.from_url(
        settings.redis_url,
        username=settings.redis_username or None,
        password=settings.redis_password or None,
        decode_responses=True,
    )
    try:
        publisher = RedisCaptionPublisher(
            redis,
            settings.redis_stream_key,
            stream_maxlen=settings.caption_stream_maxlen,
            publish_timeout_seconds=settings.caption_publish_timeout_seconds,
        )
        await run_dispatched_room_job(
            context,
            lambda: registry.create(settings.stt_provider),
            publisher,
            session_lease_factory=lambda session_id, owner_id: RedisSessionLease(
                redis,
                session_id,
                owner_id,
                ttl_seconds=settings.session_lease_ttl_seconds,
                operation_timeout_seconds=settings.redis_operation_timeout_seconds,
            ),
            lifecycle_reporter_factory=lambda metadata, job_id: build_lifecycle_reporter(
                settings, metadata, job_id
            ),
            audio_source_factory=partial(
                LiveKitInstructorAudioSource,
                rtc_config=rtc_config,
            ),
            language=settings.asr_language,
            shutdown_timeout_seconds=settings.stt_shutdown_timeout_seconds,
            drain_timeout_seconds=settings.stt_drain_timeout_seconds,
            cleanup_timeout_seconds=settings.stt_cleanup_timeout_seconds,
        )
    finally:
        await redis.aclose()


def main() -> None:
    settings = Settings.from_env()
    settings.validate_agent_server()
    cli.run_app(build_agent_server(settings))


if __name__ == "__main__":
    main()
