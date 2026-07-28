from __future__ import annotations

import pytest

from app.stt.registry import (
    MissingPrewarmedSttResourceError,
    SttEngineRegistry,
    SttProviderExecutionProfile,
    UnknownSttProviderError,
)


def test_registry_normalizes_provider_name_and_creates_lazily() -> None:
    marker = object()
    created = 0

    def create() -> object:
        nonlocal created
        created += 1
        return marker

    registry = SttEngineRegistry()
    registry.register("stub", create)  # type: ignore[arg-type]

    assert created == 0
    assert registry.create(" STUB ") is marker
    assert created == 1


def test_registry_rejects_blank_and_duplicate_provider_names() -> None:
    registry = SttEngineRegistry()

    with pytest.raises(ValueError, match="provider must not be blank"):
        registry.register(" ", lambda: object())  # type: ignore[arg-type,return-value]

    registry.register("stub", lambda: object())  # type: ignore[arg-type,return-value]
    with pytest.raises(ValueError, match="provider already registered: stub"):
        registry.register(" STUB ", lambda: object())  # type: ignore[arg-type,return-value]


def test_unknown_provider_fails_fast_with_sorted_supported_names() -> None:
    registry = SttEngineRegistry()
    registry.register("stub", lambda: object())  # type: ignore[arg-type,return-value]
    registry.register("nemotron", lambda: object())  # type: ignore[arg-type,return-value]

    with pytest.raises(UnknownSttProviderError, match="supported: nemotron, stub"):
        registry.create("missing")


def test_resolves_provider_owned_pool_defaults_and_enforces_cap() -> None:
    registry = SttEngineRegistry()
    registry.register(
        "local",
        lambda: object(),  # type: ignore[return-value]
        execution_profile=SttProviderExecutionProfile(
            max_active_jobs=12,
            default_max_active_jobs=12,
            default_num_idle_processes=2,
            initialize_process_timeout_seconds=120,
            job_memory_warn_mb=1536,
        ),
    )

    resolved = registry.resolve_worker_pool(
        "local",
        max_active_jobs=None,
        num_idle_processes=None,
    )

    assert resolved.max_active_jobs == 12
    assert resolved.num_idle_processes == 2
    assert resolved.initialize_process_timeout_seconds == 120
    assert resolved.job_memory_warn_mb == 1536
    with pytest.raises(RuntimeError, match="at most 12 for local"):
        registry.resolve_worker_pool(
            "local",
            max_active_jobs=13,
            num_idle_processes=None,
        )


@pytest.mark.parametrize("idle_processes", [0, 13])
def test_rejects_idle_processes_outside_active_capacity(idle_processes: int) -> None:
    registry = SttEngineRegistry()
    registry.register("stub", lambda: object())  # type: ignore[arg-type,return-value]

    with pytest.raises(RuntimeError, match="STT_NUM_IDLE_PROCESSES"):
        registry.resolve_worker_pool(
            "stub",
            max_active_jobs=12,
            num_idle_processes=idle_processes,
        )


def test_prewarmed_resource_is_consumed_exactly_once() -> None:
    resource = object()
    engine = object()
    lazy_engine = object()
    prewarm_calls = 0

    def prewarm() -> object:
        nonlocal prewarm_calls
        prewarm_calls += 1
        return resource

    registry = SttEngineRegistry()
    registry.register(
        "local",
        lambda: lazy_engine,  # type: ignore[return-value]
        process_resource_factory=prewarm,
        prewarmed_engine_factory=lambda actual: (
            engine if actual is resource else pytest.fail("unexpected resource")
        ),  # type: ignore[arg-type,return-value]
    )
    userdata: dict[str, object] = {}

    registry.prewarm("local", userdata)

    assert prewarm_calls == 1
    assert registry.create("local", process_userdata=userdata) is engine
    assert userdata == {}
    with pytest.raises(MissingPrewarmedSttResourceError, match="missing prewarmed"):
        registry.create("local", process_userdata=userdata)
    assert registry.create("local") is lazy_engine


def test_failed_engine_handoff_closes_consumed_process_resource() -> None:
    class Resource:
        close_calls = 0

        def close(self) -> None:
            self.close_calls += 1

    resource = Resource()
    registry = SttEngineRegistry()
    registry.register(
        "local",
        lambda: object(),  # type: ignore[return-value]
        process_resource_factory=lambda: resource,
        prewarmed_engine_factory=lambda _resource: (_ for _ in ()).throw(
            RuntimeError("engine construction failed")
        ),
    )
    userdata: dict[str, object] = {}
    registry.prewarm("local", userdata)

    with pytest.raises(RuntimeError, match="engine construction failed"):
        registry.create("local", process_userdata=userdata)

    assert resource.close_calls == 1
    assert userdata == {}


def test_resource_factories_must_be_registered_as_a_pair() -> None:
    registry = SttEngineRegistry()

    with pytest.raises(ValueError, match="must be configured together"):
        registry.register(
            "local",
            lambda: object(),  # type: ignore[return-value]
            process_resource_factory=object,
        )
