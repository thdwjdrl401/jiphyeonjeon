from __future__ import annotations

from dataclasses import replace

import pytest

from app.config import Settings
from app.stt import catalog
from app.stt.providers.nemotron import NemotronStreamingEngine

BASE_SETTINGS = Settings(
    livekit_url="wss://livekit.example",
    livekit_api_key="key",
    livekit_api_secret="secret",
    stt_provider="stub",
)


def settings(**changes: object) -> Settings:
    return replace(BASE_SETTINGS, **changes)


def test_nemotron_profile_prewarms_twelve_processes_for_twelve_job_burst() -> None:
    registry = catalog.build_stt_provider_registry(settings(stt_provider="nemotron"))

    pool = registry.resolve_worker_pool(
        "nemotron",
        max_active_jobs=None,
        num_idle_processes=None,
    )

    assert pool.max_active_jobs == 12
    assert pool.num_idle_processes == 12
    assert pool.initialize_process_timeout_seconds == 120
    assert pool.job_memory_warn_mb == 2304
    with pytest.raises(RuntimeError, match="at most 12 for nemotron"):
        registry.resolve_worker_pool(
            "nemotron",
            max_active_jobs=13,
            num_idle_processes=None,
        )


def test_external_api_profile_keeps_generic_pool_defaults() -> None:
    configured = settings(
        stt_provider="openai-realtime",
        openai_api_key="openai-key",
    )
    registry = catalog.build_stt_provider_registry(configured)

    pool = registry.resolve_worker_pool(
        "openai-realtime",
        max_active_jobs=20,
        num_idle_processes=None,
    )

    assert pool.max_active_jobs == 20
    assert pool.num_idle_processes == 1
    assert pool.initialize_process_timeout_seconds == 10
    assert pool.job_memory_warn_mb == 1000


def test_selected_api_provider_validates_its_own_credentials() -> None:
    registry = catalog.build_stt_provider_registry(settings(stt_provider="openai-realtime"))

    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        registry.resolve_worker_pool(
            "openai-realtime",
            max_active_jobs=1,
            num_idle_processes=None,
        )


async def test_nemotron_prewarm_loads_in_process_and_transfers_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRecognizer:
        def __init__(self, model_id: str, language: str) -> None:
            self.model_id = model_id
            self.language = language
            self.load_calls = 0
            self.close_calls = 0

        def load(self) -> None:
            self.load_calls += 1

        def close(self) -> None:
            self.close_calls += 1

    created: list[FakeRecognizer] = []

    def build_recognizer(model_id: str, language: str) -> FakeRecognizer:
        recognizer = FakeRecognizer(model_id, language)
        created.append(recognizer)
        return recognizer

    monkeypatch.setattr(catalog, "NemotronStreamingASR", build_recognizer)
    configured = settings(
        stt_provider="nemotron",
        nemotron_model_id="local-model",
        asr_language="ko-KR",
    )
    registry = catalog.build_stt_provider_registry(configured)
    userdata: dict[str, object] = {}

    registry.prewarm("nemotron", userdata)
    engine = registry.create("nemotron", process_userdata=userdata)

    assert len(created) == 1
    recognizer = created[0]
    assert recognizer.model_id == "local-model"
    assert recognizer.language == "ko-KR"
    assert recognizer.load_calls == 1
    assert isinstance(engine, NemotronStreamingEngine)
    assert engine._recognizer is recognizer
    assert userdata == {}
    await engine.close()
    assert recognizer.close_calls == 1


def test_failed_nemotron_prewarm_closes_partial_recognizer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingRecognizer:
        close_calls = 0

        def __init__(self, _model_id: str, _language: str) -> None:
            pass

        def load(self) -> None:
            raise RuntimeError("GPU load failed")

        def close(self) -> None:
            self.close_calls += 1

    recognizer = FailingRecognizer("model", "ko-KR")
    monkeypatch.setattr(catalog, "NemotronStreamingASR", lambda *_args: recognizer)
    registry = catalog.build_stt_provider_registry(settings(stt_provider="nemotron"))

    with pytest.raises(RuntimeError, match="GPU load failed"):
        registry.prewarm("nemotron", {})

    assert recognizer.close_calls == 1
