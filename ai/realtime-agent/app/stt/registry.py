from __future__ import annotations

import math
from collections.abc import Callable, MutableMapping
from dataclasses import dataclass
from typing import Any

from app.stt.engine import StreamingSttEngine

EngineFactory = Callable[[], StreamingSttEngine]
ProviderValidator = Callable[[], None]
ProcessResourceFactory = Callable[[], object]
PrewarmedEngineFactory = Callable[[object], StreamingSttEngine]

_PROCESS_RESOURCE_KEY_PREFIX = "stt-provider-resource:"


class UnknownSttProviderError(ValueError):
    """Raised when no engine factory is registered for a provider name."""


class MissingPrewarmedSttResourceError(RuntimeError):
    """Raised when a process-backed provider starts without its setup resource."""


@dataclass(frozen=True, slots=True)
class SttProviderExecutionProfile:
    """Provider-owned limits and process-pool defaults."""

    max_active_jobs: int = 100
    default_max_active_jobs: int = 1
    default_num_idle_processes: int = 1
    initialize_process_timeout_seconds: float = 10.0
    job_memory_warn_mb: float = 1000.0

    def __post_init__(self) -> None:
        if isinstance(self.max_active_jobs, bool) or not isinstance(self.max_active_jobs, int):
            raise TypeError("max_active_jobs must be a positive integer")
        if self.max_active_jobs < 1:
            raise ValueError("max_active_jobs must be a positive integer")
        if isinstance(self.default_max_active_jobs, bool) or not isinstance(
            self.default_max_active_jobs, int
        ):
            raise TypeError("default_max_active_jobs must be a positive integer")
        if not 1 <= self.default_max_active_jobs <= self.max_active_jobs:
            raise ValueError("default_max_active_jobs must be between 1 and max_active_jobs")
        if isinstance(self.default_num_idle_processes, bool) or not isinstance(
            self.default_num_idle_processes, int
        ):
            raise TypeError("default_num_idle_processes must be a positive integer")
        if not 1 <= self.default_num_idle_processes <= self.max_active_jobs:
            raise ValueError("default_num_idle_processes must be between 1 and max_active_jobs")
        timeout = self.initialize_process_timeout_seconds
        if isinstance(timeout, bool) or not isinstance(timeout, int | float):
            raise TypeError("initialize_process_timeout_seconds must be a finite positive number")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("initialize_process_timeout_seconds must be a finite positive number")
        memory_warning = self.job_memory_warn_mb
        if isinstance(memory_warning, bool) or not isinstance(memory_warning, int | float):
            raise TypeError("job_memory_warn_mb must be a finite positive number")
        if not math.isfinite(memory_warning) or memory_warning <= 0:
            raise ValueError("job_memory_warn_mb must be a finite positive number")


@dataclass(frozen=True, slots=True)
class SttWorkerPoolConfiguration:
    max_active_jobs: int
    num_idle_processes: int
    initialize_process_timeout_seconds: float
    job_memory_warn_mb: float


@dataclass(frozen=True, slots=True)
class _SttProviderDefinition:
    engine_factory: EngineFactory
    execution_profile: SttProviderExecutionProfile
    validate: ProviderValidator | None
    process_resource_factory: ProcessResourceFactory | None
    prewarmed_engine_factory: PrewarmedEngineFactory | None

    @property
    def requires_process_resource(self) -> bool:
        return self.process_resource_factory is not None


class SttEngineRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, _SttProviderDefinition] = {}

    def register(
        self,
        provider: str,
        factory: EngineFactory,
        *,
        execution_profile: SttProviderExecutionProfile | None = None,
        validate: ProviderValidator | None = None,
        process_resource_factory: ProcessResourceFactory | None = None,
        prewarmed_engine_factory: PrewarmedEngineFactory | None = None,
    ) -> None:
        normalized = self._normalize(provider)
        if normalized in self._providers:
            raise ValueError(f"provider already registered: {normalized}")
        if (process_resource_factory is None) != (prewarmed_engine_factory is None):
            raise ValueError(
                "process_resource_factory and prewarmed_engine_factory must be configured together"
            )
        self._providers[normalized] = _SttProviderDefinition(
            engine_factory=factory,
            execution_profile=execution_profile or SttProviderExecutionProfile(),
            validate=validate,
            process_resource_factory=process_resource_factory,
            prewarmed_engine_factory=prewarmed_engine_factory,
        )

    def resolve_worker_pool(
        self,
        provider: str,
        *,
        max_active_jobs: int | None,
        num_idle_processes: int | None,
    ) -> SttWorkerPoolConfiguration:
        normalized, definition = self._lookup(provider)
        self._validate_definition(definition)
        profile = definition.execution_profile
        max_active_jobs = (
            profile.default_max_active_jobs if max_active_jobs is None else max_active_jobs
        )
        if isinstance(max_active_jobs, bool) or not isinstance(max_active_jobs, int):
            raise TypeError("STT_MAX_ACTIVE_JOBS must be an integer")
        if max_active_jobs < 1:
            raise RuntimeError("STT_MAX_ACTIVE_JOBS must be at least 1")
        if max_active_jobs > profile.max_active_jobs:
            raise RuntimeError(
                f"STT_MAX_ACTIVE_JOBS must be at most {profile.max_active_jobs} for {normalized}"
            )
        idle_processes = (
            profile.default_num_idle_processes if num_idle_processes is None else num_idle_processes
        )
        if isinstance(idle_processes, bool) or not isinstance(idle_processes, int):
            raise TypeError("STT_NUM_IDLE_PROCESSES must be an integer")
        if idle_processes < 1:
            raise RuntimeError("STT_NUM_IDLE_PROCESSES must be at least 1")
        if idle_processes > max_active_jobs:
            raise RuntimeError("STT_NUM_IDLE_PROCESSES must not exceed STT_MAX_ACTIVE_JOBS")
        return SttWorkerPoolConfiguration(
            max_active_jobs=max_active_jobs,
            num_idle_processes=idle_processes,
            initialize_process_timeout_seconds=profile.initialize_process_timeout_seconds,
            job_memory_warn_mb=profile.job_memory_warn_mb,
        )

    def prewarm(
        self,
        provider: str,
        process_userdata: MutableMapping[str, Any],
    ) -> None:
        normalized, definition = self._lookup(provider)
        self._validate_definition(definition)
        factory = definition.process_resource_factory
        if factory is None:
            return
        resource_key = self._resource_key(normalized)
        if resource_key in process_userdata:
            raise RuntimeError(f"STT process resource is already initialized for {normalized}")
        process_userdata[resource_key] = factory()

    def create(
        self,
        provider: str,
        *,
        process_userdata: MutableMapping[str, Any] | None = None,
    ) -> StreamingSttEngine:
        normalized, definition = self._lookup(provider)
        self._validate_definition(definition)
        if not definition.requires_process_resource or process_userdata is None:
            return definition.engine_factory()

        resource_key = self._resource_key(normalized)
        try:
            resource = process_userdata.pop(resource_key)
        except KeyError as exc:
            raise MissingPrewarmedSttResourceError(
                f"missing prewarmed STT process resource for {normalized}"
            ) from exc

        factory = definition.prewarmed_engine_factory
        assert factory is not None
        try:
            return factory(resource)
        except BaseException:
            self._close_resource(resource)
            raise

    def _lookup(self, provider: str) -> tuple[str, _SttProviderDefinition]:
        normalized = self._normalize(provider)
        try:
            definition = self._providers[normalized]
        except KeyError as exc:
            supported = ", ".join(sorted(self._providers)) or "none"
            raise UnknownSttProviderError(
                f"unknown STT provider '{provider}'; supported: {supported}"
            ) from exc
        return normalized, definition

    @staticmethod
    def _normalize(provider: str) -> str:
        normalized = provider.strip().lower()
        if not normalized:
            raise ValueError("provider must not be blank")
        return normalized

    @staticmethod
    def _validate_definition(definition: _SttProviderDefinition) -> None:
        if definition.validate is not None:
            definition.validate()

    @staticmethod
    def _resource_key(provider: str) -> str:
        return f"{_PROCESS_RESOURCE_KEY_PREFIX}{provider}"

    @staticmethod
    def _close_resource(resource: object) -> None:
        close = getattr(resource, "close", None)
        if callable(close):
            close()
