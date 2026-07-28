from __future__ import annotations

import pickle
from dataclasses import replace
from functools import partial
from types import SimpleNamespace
from typing import ClassVar
from uuid import UUID

import pytest
from livekit.agents import AgentServer as LiveKitAgentServer

from app import main as agent_main
from app.config import Settings
from app.jobs.lifecycle import DisabledLifecycleReporter
from app.jobs.metadata import JobMetadata
from app.stt import catalog as stt_catalog
from app.stt.providers.stub import StubStreamingEngine

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
LESSON_ID = UUID("22222222-2222-4222-8222-222222222222")
BASE_SETTINGS = Settings(
    livekit_url="wss://livekit.example",
    livekit_api_key="livekit-key",
    livekit_api_secret="livekit-secret",
    stt_provider="stub",
)


def settings(**changes: object) -> Settings:
    return replace(BASE_SETTINGS, **changes)


def metadata() -> JobMetadata:
    return JobMetadata(
        contract_version="1",
        session_id=SESSION_ID,
        lesson_id=LESSON_ID,
        correlation_id="trace-1",
    )


def test_builds_lazy_provider_registry_from_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []
    stub_engine = object()
    openai_engine = object()
    nemotron_engine = object()

    def build_stub() -> object:
        calls.append(("stub",))
        return stub_engine

    def build_openai(api_key: str, model: str, *, delay: str) -> object:
        calls.append(("openai-realtime", api_key, model, delay))
        return openai_engine

    def build_nemotron(model_id: str, language: str) -> object:
        calls.append(("nemotron", model_id, language))
        return nemotron_engine

    monkeypatch.setattr(stt_catalog, "StubStreamingEngine", build_stub)
    monkeypatch.setattr(stt_catalog, "OpenAiRealtimeStreamingEngine", build_openai)
    monkeypatch.setattr(stt_catalog, "NemotronStreamingEngine", build_nemotron)
    configured = settings(
        openai_api_key="openai-key",
        openai_realtime_model="transcribe-model",
        openai_realtime_delay="minimal",
        nemotron_model_id="nemotron-model",
        asr_language="ko-KR",
    )

    registry = agent_main.build_engine_registry(configured)

    assert calls == []
    assert registry.create("stub") is stub_engine
    assert registry.create("openai-realtime") is openai_engine
    assert registry.create("nemotron") is nemotron_engine
    assert calls == [
        ("stub",),
        ("openai-realtime", "openai-key", "transcribe-model", "minimal"),
        ("nemotron", "nemotron-model", "ko-KR"),
    ]


def test_disabled_callback_factory_does_not_construct_http_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_callback(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("callback must remain disabled")

    monkeypatch.setattr(agent_main, "SpringStatusCallback", unexpected_callback)

    reporter = agent_main.build_lifecycle_reporter(settings(), metadata(), "job-1")

    assert isinstance(reporter, DisabledLifecycleReporter)


def test_enabled_callback_factory_passes_candidate_contract_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    callback = object()
    calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def build_callback(*args: object, **kwargs: object) -> object:
        calls.append((args, kwargs))
        return callback

    monkeypatch.setattr(agent_main, "SpringStatusCallback", build_callback)
    configured = settings(
        spring_status_callback_enabled=True,
        spring_status_callback_url="https://spring.example/internal/live-agent",
        spring_status_callback_secret="x" * 32,
        spring_status_callback_timeout_seconds=4.5,
        spring_status_callback_attempts=2,
    )

    reporter = agent_main.build_lifecycle_reporter(configured, metadata(), "job-1")

    assert reporter is callback
    assert calls == [
        (
            (
                "https://spring.example/internal/live-agent",
                "x" * 32,
                SESSION_ID,
                LESSON_ID,
                "job-1",
                "trace-1",
            ),
            {"timeout_seconds": 4.5, "max_attempts": 2},
        )
    ]


class FakeAgentServer:
    def __init__(self, **kwargs: object) -> None:
        self.options = kwargs
        self.active_jobs: list[object] = []
        self.entrypoint = None
        self.registered_agent_name: str | None = None

    def rtc_session(self, entrypoint, *, agent_name: str):
        self.entrypoint = entrypoint
        self.registered_agent_name = agent_name
        return entrypoint


def test_agent_server_uses_credentials_named_registration_and_bounded_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent_main, "AgentServer", FakeAgentServer)
    configured = settings(agent_name="liveclass-stt", max_active_jobs=2)

    server = agent_main.build_agent_server(configured)

    assert isinstance(server, FakeAgentServer)
    assert server.options["ws_url"] == "wss://livekit.example"
    assert server.options["api_key"] == "livekit-key"
    assert server.options["api_secret"] == "livekit-secret"
    assert server.options["load_threshold"] == 1.0
    assert server.options["num_idle_processes"] == 1
    assert server.options["initialize_process_timeout"] == 10.0
    assert server.options["job_memory_warn_mb"] == 1000.0
    assert callable(server.options["setup_fnc"])
    assert server.registered_agent_name == "liveclass-stt"
    assert callable(server.entrypoint)
    restored_entrypoint = pickle.loads(pickle.dumps(server.entrypoint))
    assert restored_entrypoint.keywords["settings"] == configured
    restored_setup = pickle.loads(pickle.dumps(server.options["setup_fnc"]))
    assert restored_setup.keywords["settings"] == configured

    load_fnc = server.options["load_fnc"]
    assert callable(load_fnc)
    assert load_fnc(server) == 0.0
    server.active_jobs = [object()]
    assert load_fnc(server) == 0.5
    server.active_jobs = [object(), object()]
    assert load_fnc(server) == 1.0
    server.active_jobs = [object(), object(), object()]
    assert load_fnc(server) == 1.0


def test_nemotron_server_uses_twelve_job_profile_without_loading_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent_main, "AgentServer", FakeAgentServer)
    configured = settings(stt_provider="nemotron")

    server = agent_main.build_agent_server(configured)

    assert isinstance(server, FakeAgentServer)
    assert server.options["num_idle_processes"] == 12
    assert server.options["initialize_process_timeout"] == 120
    assert server.options["job_memory_warn_mb"] == 2304
    load_fnc = server.options["load_fnc"]
    server.active_jobs = [object()] * 11
    assert load_fnc(server) == pytest.approx(11 / 12)
    server.active_jobs.append(object())
    assert load_fnc(server) == 1.0


def test_unknown_provider_fails_before_agent_server_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent_main, "AgentServer", FakeAgentServer)

    with pytest.raises(ValueError, match="supported: nemotron, openai-realtime, stub"):
        agent_main.build_agent_server(settings(stt_provider="unknown"))


def test_livekit_1_6_reserved_slots_fail_closed_during_assignment_burst() -> None:
    """Pin the private calculation this safety gate relies on in livekit-agents 1.6.6."""
    load_fnc = agent_main._build_active_job_load(2)
    server = LiveKitAgentServer(
        load_fnc=load_fnc,
        load_threshold=1.0,
        num_idle_processes=1,
    )
    server._devmode = False
    server._simulation = False
    server._draining = False

    # Before the first accepted job is launched, 1.6.6 counts one reserved request as full when
    # one idle runner is configured. That prevents concurrent availability requests from bursting
    # past the limit while active_jobs is still empty.
    server._proc_pool = SimpleNamespace(processes=[])
    server._worker_load = load_fnc(server)
    server._reserved_slots = 1
    assert server._get_effective_load() == 1.0
    assert server._is_available() is False

    # After a job is active, active/max makes each additional reserved slot exactly one slot.
    server._proc_pool = SimpleNamespace(processes=[SimpleNamespace(running_job=object())])
    server._worker_load = load_fnc(server)
    server._reserved_slots = 1
    assert server._get_effective_load() == 1.0
    assert server._is_available() is False


def test_livekit_1_6_twelve_idle_slots_admit_twelve_job_burst() -> None:
    """Pin the warm-pool size required for a 12-request cold assignment burst."""
    load_fnc = agent_main._build_active_job_load(12)
    server = LiveKitAgentServer(
        load_fnc=load_fnc,
        load_threshold=1.0,
        num_idle_processes=12,
    )
    server._devmode = False
    server._simulation = False
    server._draining = False
    server._proc_pool = SimpleNamespace(processes=[])
    server._worker_load = load_fnc(server)

    server._reserved_slots = 11
    assert server._get_effective_load() == pytest.approx(11 / 12)
    assert server._is_available() is True

    server._reserved_slots = 12
    assert server._get_effective_load() == 1.0
    assert server._is_available() is False


class FakeRedisClient:
    def __init__(self) -> None:
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1


class FakeRedis:
    calls: ClassVar[list[tuple[str, str | None, str | None, bool]]] = []
    clients: ClassVar[list[FakeRedisClient]] = []

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        username: str | None,
        password: str | None,
        decode_responses: bool,
    ) -> FakeRedisClient:
        cls.calls.append((url, username, password, decode_responses))
        client = FakeRedisClient()
        cls.clients.append(client)
        return client


class FakePublisher:
    def __init__(
        self,
        client: FakeRedisClient,
        stream_key: str,
        *,
        stream_maxlen: int,
        publish_timeout_seconds: float,
    ) -> None:
        self.client = client
        self.stream_key = stream_key
        self.stream_maxlen = stream_maxlen
        self.publish_timeout_seconds = publish_timeout_seconds


class FakeLease:
    def __init__(
        self,
        client: FakeRedisClient,
        session_id: UUID,
        owner_id: str,
        *,
        ttl_seconds: int,
        operation_timeout_seconds: float,
    ) -> None:
        self.client = client
        self.session_id = session_id
        self.owner_id = owner_id
        self.ttl_seconds = ttl_seconds
        self.operation_timeout_seconds = operation_timeout_seconds


async def test_entrypoint_shares_one_redis_client_and_delegates_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeRedis.calls = []
    FakeRedis.clients = []
    captured: dict[str, object] = {}

    async def run_job(
        context: object,
        engine_factory,
        publisher: FakePublisher,
        **kwargs: object,
    ) -> None:
        captured["context"] = context
        captured["engine"] = engine_factory()
        captured["publisher"] = publisher
        captured["lease"] = kwargs["session_lease_factory"](SESSION_ID, "job-1")
        captured["reporter"] = kwargs["lifecycle_reporter_factory"](metadata(), "job-1")
        captured["audio_source_factory"] = kwargs["audio_source_factory"]
        captured["language"] = kwargs["language"]
        captured["shutdown_timeout_seconds"] = kwargs["shutdown_timeout_seconds"]
        captured["drain_timeout_seconds"] = kwargs["drain_timeout_seconds"]
        captured["cleanup_timeout_seconds"] = kwargs["cleanup_timeout_seconds"]

    monkeypatch.setattr(agent_main, "AgentServer", FakeAgentServer)
    monkeypatch.setattr(
        agent_main,
        "create_redis_client",
        lambda connection: FakeRedis.from_url(
            connection.url,
            username=connection.username or None,
            password=connection.password or None,
            decode_responses=True,
        ),
    )
    monkeypatch.setattr(agent_main, "RedisCaptionPublisher", FakePublisher)
    monkeypatch.setattr(agent_main, "RedisSessionLease", FakeLease)
    monkeypatch.setattr(agent_main, "run_dispatched_room_job", run_job)
    configured = settings(
        redis_url="redis://app-redis:6379/3",
        redis_username="",
        redis_password="redis-secret",
        redis_stream_key="candidate:captions",
        caption_stream_maxlen=2_500,
        session_lease_ttl_seconds=45,
        caption_publish_timeout_seconds=1.25,
        redis_operation_timeout_seconds=0.5,
        stt_shutdown_timeout_seconds=11.0,
        stt_drain_timeout_seconds=6.0,
        stt_cleanup_timeout_seconds=0.75,
        asr_language="en-US",
        livekit_turn_url="turn:127.0.0.1:3478?transport=tcp",
        livekit_turn_secret="turn-secret",
    )
    context = SimpleNamespace(proc=SimpleNamespace(userdata={}))
    server = agent_main.build_agent_server(configured)

    await server.entrypoint(context)

    assert FakeRedis.calls == [("redis://app-redis:6379/3", None, "redis-secret", True)]
    assert len(FakeRedis.clients) == 1
    redis_client = FakeRedis.clients[0]
    publisher = captured["publisher"]
    lease = captured["lease"]
    assert isinstance(publisher, FakePublisher)
    assert isinstance(lease, FakeLease)
    assert publisher.client is redis_client
    assert publisher.stream_key == "candidate:captions"
    assert publisher.stream_maxlen == 2_500
    assert publisher.publish_timeout_seconds == 1.25
    assert lease.client is redis_client
    assert lease.ttl_seconds == 45
    assert lease.operation_timeout_seconds == 0.5
    assert isinstance(captured["engine"], StubStreamingEngine)
    assert isinstance(captured["reporter"], DisabledLifecycleReporter)
    assert captured["context"] is context
    assert captured["language"] == "en-US"
    assert captured["shutdown_timeout_seconds"] == 11.0
    assert captured["drain_timeout_seconds"] == 6.0
    assert captured["cleanup_timeout_seconds"] == 0.75
    audio_source_factory = captured["audio_source_factory"]
    assert isinstance(audio_source_factory, partial)
    rtc_config = audio_source_factory.keywords["rtc_config"]
    assert rtc_config.ice_servers[0].urls == ["turn:127.0.0.1:3478?transport=tcp"]
    assert redis_client.close_calls == 1


async def test_entrypoint_closes_redis_when_job_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeRedis.calls = []
    FakeRedis.clients = []

    async def fail_job(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("job failed")

    monkeypatch.setattr(agent_main, "AgentServer", FakeAgentServer)
    monkeypatch.setattr(
        agent_main,
        "create_redis_client",
        lambda connection: FakeRedis.from_url(
            connection.url,
            username=connection.username or None,
            password=connection.password or None,
            decode_responses=True,
        ),
    )
    monkeypatch.setattr(agent_main, "run_dispatched_room_job", fail_job)
    server = agent_main.build_agent_server(settings())

    with pytest.raises(RuntimeError, match="job failed"):
        await server.entrypoint(SimpleNamespace(proc=SimpleNamespace(userdata={})))

    assert len(FakeRedis.clients) == 1
    assert FakeRedis.clients[0].close_calls == 1


def test_main_validates_before_building_and_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []
    runtime_settings = SimpleNamespace()
    server = object()

    class FakeSettingsLoader:
        @classmethod
        def from_env(cls) -> object:
            calls.append("from_env")
            return runtime_settings

    def validate() -> None:
        calls.append("validate")

    runtime_settings.validate_agent_server = validate
    monkeypatch.setattr(agent_main, "Settings", FakeSettingsLoader)
    monkeypatch.setattr(
        agent_main,
        "build_agent_server",
        lambda actual: calls.append(("build", actual)) or server,
    )
    monkeypatch.setattr(
        agent_main.cli,
        "run_app",
        lambda actual: calls.append(("run", actual)),
    )

    agent_main.main()

    assert calls == [
        "from_env",
        "validate",
        ("build", runtime_settings),
        ("run", server),
    ]
