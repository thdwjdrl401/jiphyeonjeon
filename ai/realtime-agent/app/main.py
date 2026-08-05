from __future__ import annotations

from collections.abc import Callable
from functools import partial

from livekit.agents import AgentServer, JobContext, JobProcess, cli

from app.adapters.redis_caption_publisher import RedisCaptionPublisher
from app.adapters.redis_session_lease import RedisSessionLease
from app.adapters.spring_status_callback import SpringStatusCallback
from app.config import Settings
from app.connections import create_redis_client
from app.health import ProcessReadinessMarker, SttHealthServer, SttReadinessState
from app.jobs.dispatched_room_job import run_dispatched_room_job
from app.jobs.lifecycle import DisabledLifecycleReporter, LifecycleReporter
from app.jobs.metadata import JobMetadata
from app.livekit.audio_source import LiveKitInstructorAudioSource
from app.livekit.rtc_config import build_turn_rtc_config
from app.stt.catalog import (
    build_stt_provider_readiness_probe,
    build_stt_provider_registry,
)
from app.stt.registry import SttEngineRegistry, SttWorkerPoolConfiguration

_LOAD_THRESHOLD = 1.0


def build_engine_registry(settings: Settings) -> SttEngineRegistry:
    return build_stt_provider_registry(settings)


def resolve_worker_pool(settings: Settings) -> SttWorkerPoolConfiguration:
    return build_engine_registry(settings).resolve_worker_pool(
        settings.stt_provider,
        max_active_jobs=settings.max_active_jobs,
        num_idle_processes=settings.num_idle_processes,
    )


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


def _livekit_connection_is_healthy(server: AgentServer) -> bool:
    """Pin the reconnect flags used by livekit-agents 1.6.6."""

    try:
        return (
            server.id != "unregistered"
            and not server._connecting  # pyright: ignore[reportPrivateUsage]
            and not server._connection_failed  # pyright: ignore[reportPrivateUsage]
        )
    except AttributeError:
        return False


def build_agent_server(
    settings: Settings,
    *,
    worker_pool: SttWorkerPoolConfiguration | None = None,
    readiness_state: SttReadinessState | None = None,
) -> AgentServer:
    worker_pool = worker_pool or resolve_worker_pool(settings)
    server = AgentServer(
        ws_url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        host="127.0.0.1",
        port=0,
        load_fnc=_build_active_job_load(worker_pool.max_active_jobs),
        load_threshold=_LOAD_THRESHOLD,
        num_idle_processes=worker_pool.num_idle_processes,
        initialize_process_timeout=worker_pool.initialize_process_timeout_seconds,
        job_memory_warn_mb=worker_pool.job_memory_warn_mb,
        setup_fnc=partial(
            _setup_stt_process,
            settings=settings,
            readiness_marker=readiness_state.process_marker if readiness_state else None,
        ),
    )
    if readiness_state is not None:
        readiness_state.set_livekit_connection_probe(
            partial(_livekit_connection_is_healthy, server)
        )
        server.on("worker_started", readiness_state.mark_worker_started)
        server.on("worker_registered", readiness_state.mark_livekit_connected)
    entrypoint = partial(_run_agent_job, settings=settings)
    server.rtc_session(entrypoint, agent_name=settings.agent_name)
    return server


def _setup_stt_process(
    process: JobProcess,
    *,
    settings: Settings,
    readiness_marker: ProcessReadinessMarker | None = None,
) -> None:
    registry = build_engine_registry(settings)
    registry.prewarm(settings.stt_provider, process.userdata)
    if readiness_marker is not None:
        readiness_marker.mark_current_process_ready()


async def _run_agent_job(context: JobContext, *, settings: Settings) -> None:
    registry = build_engine_registry(settings)
    process_userdata = context.proc.userdata
    rtc_config = build_turn_rtc_config(
        settings.livekit_turn_url,
        settings.livekit_turn_secret,
    )
    redis = create_redis_client(settings.redis_connection())
    try:
        publisher = RedisCaptionPublisher(
            redis,
            settings.redis_stream_key,
            stream_maxlen=settings.caption_stream_maxlen,
            publish_timeout_seconds=settings.caption_publish_timeout_seconds,
        )
        await run_dispatched_room_job(
            context,
            lambda: registry.create(
                settings.stt_provider,
                process_userdata=process_userdata,
            ),
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
    worker_pool = resolve_worker_pool(settings)
    readiness_state = SttReadinessState(
        settings.stt_provider,
        worker_pool.num_idle_processes,
    )
    provider_probe = build_stt_provider_readiness_probe(settings)
    if provider_probe is not None:
        readiness_state.set_stt_provider_probe(provider_probe)
    try:
        health_server = SttHealthServer(
            settings.health_host,
            settings.health_port,
            readiness_state,
        )
    except BaseException:
        readiness_state.close()
        raise
    try:
        server = build_agent_server(
            settings,
            worker_pool=worker_pool,
            readiness_state=readiness_state,
        )
        health_server.start()
        cli.run_app(server)
    finally:
        health_server.close()


if __name__ == "__main__":
    main()
