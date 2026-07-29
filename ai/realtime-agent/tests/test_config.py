from __future__ import annotations

from dataclasses import replace

import pytest

from app.config import Settings

BASE_ENV = {
    "LIVEKIT_URL": "wss://livekit.example",
    "LIVEKIT_API_KEY": "key",
    "LIVEKIT_API_SECRET": "secret",
    "STT_ENGINE_PROVIDER": "stub",
}


def test_uses_application_redis_without_assuming_livekit_redis_port() -> None:
    settings = Settings.from_env(BASE_ENV)

    assert settings.redis_url == "redis://localhost:6379/0"
    assert ":6380" not in settings.redis_url
    assert settings.caption_stream_maxlen == 10_000
    assert settings.stt_shutdown_timeout_seconds == 12
    assert settings.stt_drain_timeout_seconds == 7
    assert settings.stt_cleanup_timeout_seconds == 1
    assert settings.caption_publish_timeout_seconds == 1.25
    assert settings.redis_operation_timeout_seconds == 1
    assert settings.max_active_jobs is None
    assert settings.num_idle_processes is None
    assert settings.health_host == "127.0.0.1"
    assert settings.health_port == 8081


def test_accepts_explicit_loopback_health_port() -> None:
    settings = Settings.from_env(
        {**BASE_ENV, "STT_HEALTH_HOST": "127.0.0.1", "STT_HEALTH_PORT": "18081"}
    )

    settings.validate_agent_server()

    assert settings.health_host == "127.0.0.1"
    assert settings.health_port == 18081


def test_rejects_non_loopback_health_bind() -> None:
    settings = Settings.from_env({**BASE_ENV, "STT_HEALTH_HOST": "0.0.0.0"})

    with pytest.raises(RuntimeError, match="STT_HEALTH_HOST must be 127.0.0.1"):
        settings.validate_agent_server()


@pytest.mark.parametrize("value", ["0", "65536"])
def test_rejects_health_port_outside_tcp_range(value: str) -> None:
    settings = Settings.from_env({**BASE_ENV, "STT_HEALTH_PORT": value})

    with pytest.raises(RuntimeError, match="STT_HEALTH_PORT must be between"):
        settings.validate_agent_server()


def test_rejects_noninteger_health_port() -> None:
    with pytest.raises(ValueError, match="STT_HEALTH_PORT must be an integer"):
        Settings.from_env({**BASE_ENV, "STT_HEALTH_PORT": "health"})


def test_default_redis_user_accepts_password_without_username() -> None:
    settings = Settings.from_env({**BASE_ENV, "REDIS_USERNAME": "", "REDIS_PASSWORD": "secret"})

    assert settings.redis_username == ""
    assert settings.redis_password == "secret"
    assert "secret" not in repr(settings)


def test_rejects_missing_livekit_credentials() -> None:
    settings = Settings.from_env({"LIVEKIT_URL": "wss://livekit.example"})

    with pytest.raises(RuntimeError, match="LIVEKIT_API_KEY, LIVEKIT_API_SECRET"):
        settings.validate_agent_server()


def test_turn_configuration_requires_dedicated_secret() -> None:
    settings = Settings.from_env(
        {**BASE_ENV, "LIVEKIT_TURN_URL": "turn:127.0.0.1:3478?transport=tcp"}
    )

    with pytest.raises(RuntimeError, match="LIVEKIT_TURN_SECRET"):
        settings.validate_agent_server()


@pytest.mark.parametrize(
    "turn_url",
    [
        "turn:127.0.0.1:3478",
        "turn:127.0.0.1:3478?transport=tcp",
        "turns:turn.example.test:5349?transport=tcp",
    ],
)
def test_accepts_turn_tunnel_configuration_without_requiring_transport_query(
    turn_url: str,
) -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "LIVEKIT_TURN_URL": turn_url,
            "LIVEKIT_TURN_SECRET": "turn-secret",
        }
    )

    settings.validate_agent_server()


@pytest.mark.parametrize(
    "turn_url",
    [
        "turn:",
        "turn:127.0.0.1",
        "turn:127.0.0.1:not-a-port",
        "turn:127.0.0.1:70000",
        "turn:user@127.0.0.1:3478",
    ],
)
def test_rejects_turn_url_without_valid_host_and_port(turn_url: str) -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "LIVEKIT_TURN_URL": turn_url,
            "LIVEKIT_TURN_SECRET": "turn-secret",
        }
    )

    with pytest.raises(RuntimeError, match="valid host and port"):
        settings.validate_agent_server()


def test_rejects_whitespace_only_turn_secret() -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "LIVEKIT_TURN_URL": "turn:127.0.0.1:3478",
            "LIVEKIT_TURN_SECRET": "   ",
        }
    )

    with pytest.raises(RuntimeError, match="LIVEKIT_TURN_SECRET"):
        settings.validate_agent_server()


@pytest.mark.parametrize("value", ["0", "-1"])
def test_rejects_nonpositive_caption_stream_maxlen(value: str) -> None:
    settings = Settings.from_env({**BASE_ENV, "CAPTION_STREAM_MAXLEN": value})

    with pytest.raises(RuntimeError, match="positive integer"):
        settings.validate_agent_server()


def test_rejects_noninteger_caption_stream_maxlen() -> None:
    with pytest.raises(ValueError, match="CAPTION_STREAM_MAXLEN must be an integer"):
        Settings.from_env({**BASE_ENV, "CAPTION_STREAM_MAXLEN": "ten-thousand"})


def test_rejects_boolean_caption_stream_maxlen_in_programmatic_settings() -> None:
    settings = replace(Settings.from_env(BASE_ENV), caption_stream_maxlen=True)

    with pytest.raises(TypeError, match="positive integer"):
        settings.validate_agent_server()


@pytest.mark.parametrize("value", ["treu", "enabled", "2"])
def test_rejects_invalid_callback_flag(value: str) -> None:
    with pytest.raises(ValueError, match="must be true or false"):
        Settings.from_env({**BASE_ENV, "SPRING_STATUS_CALLBACK_ENABLED": value})


def test_callback_credentials_are_required_only_when_enabled() -> None:
    Settings.from_env(BASE_ENV).validate_agent_server()
    enabled = Settings.from_env({**BASE_ENV, "SPRING_STATUS_CALLBACK_ENABLED": "true"})

    with pytest.raises(RuntimeError, match="SPRING_STATUS_CALLBACK_URL, AI_CALLBACK_SECRET"):
        enabled.validate_agent_server()


def test_rejects_short_callback_secret() -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "SPRING_STATUS_CALLBACK_ENABLED": "true",
            "SPRING_STATUS_CALLBACK_URL": "https://spring.example/internal/live-agent",
            "AI_CALLBACK_SECRET": "too-short",
        }
    )

    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        settings.validate_agent_server()


def test_provider_must_be_explicit() -> None:
    with pytest.raises(RuntimeError, match="STT_ENGINE_PROVIDER"):
        Settings.from_env(
            {
                "LIVEKIT_URL": "wss://livekit.example",
                "LIVEKIT_API_KEY": "key",
                "LIVEKIT_API_SECRET": "secret",
            }
        ).validate_agent_server()


def test_common_config_does_not_branch_on_provider_name() -> None:
    Settings.from_env(
        {**BASE_ENV, "STT_ENGINE_PROVIDER": "future-provider"}
    ).validate_agent_server()


def test_accepts_twelve_active_jobs_and_explicit_warm_pool() -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "STT_ENGINE_PROVIDER": "nemotron",
            "STT_MAX_ACTIVE_JOBS": "12",
            "STT_NUM_IDLE_PROCESSES": "2",
        }
    )

    settings.validate_agent_server()

    assert settings.max_active_jobs == 12
    assert settings.num_idle_processes == 2


@pytest.mark.parametrize("value", ["0", "13"])
def test_rejects_idle_processes_outside_active_jobs(value: str) -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "STT_MAX_ACTIVE_JOBS": "12",
            "STT_NUM_IDLE_PROCESSES": value,
        }
    )

    with pytest.raises(RuntimeError, match="STT_NUM_IDLE_PROCESSES"):
        settings.validate_agent_server()


def test_rejects_noninteger_idle_processes() -> None:
    with pytest.raises(ValueError, match="STT_NUM_IDLE_PROCESSES must be an integer"):
        Settings.from_env({**BASE_ENV, "STT_NUM_IDLE_PROCESSES": "two"})


def test_accepts_complete_callback_configuration() -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "SPRING_STATUS_CALLBACK_ENABLED": "true",
            "SPRING_STATUS_CALLBACK_URL": "https://spring.example/internal/live-agent",
            "AI_CALLBACK_SECRET": "x" * 32,
            "SPRING_STATUS_CALLBACK_ATTEMPTS": "2",
        }
    )

    settings.validate_agent_server()


@pytest.mark.parametrize("value", ["nan", "inf", "-inf", "0", "-1"])
def test_rejects_non_finite_or_non_positive_callback_timeout(value: str) -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "SPRING_STATUS_CALLBACK_TIMEOUT_SECONDS": value,
        }
    )

    with pytest.raises(RuntimeError, match="finite positive number"):
        settings.validate_agent_server()


def test_rejects_boolean_timeout_in_programmatic_settings() -> None:
    settings = replace(
        Settings.from_env(BASE_ENV),
        spring_status_callback_timeout_seconds=True,
    )

    with pytest.raises(TypeError, match="finite positive number"):
        settings.validate_agent_server()


def test_rejects_shutdown_budget_without_livekit_cancellation_headroom() -> None:
    settings = Settings.from_env({**BASE_ENV, "STT_SHUTDOWN_TIMEOUT_SECONDS": "14"})

    with pytest.raises(RuntimeError, match="at most 13 seconds"):
        settings.validate_agent_server()


def test_rejects_stage_ceilings_that_exceed_shared_shutdown_budget() -> None:
    settings = Settings.from_env(
        {
            **BASE_ENV,
            "SPRING_STATUS_CALLBACK_ENABLED": "true",
            "SPRING_STATUS_CALLBACK_URL": "https://spring.example/internal/live-agent",
            "AI_CALLBACK_SECRET": "x" * 32,
            "STT_SHUTDOWN_TIMEOUT_SECONDS": "10",
            "STT_DRAIN_TIMEOUT_SECONDS": "7",
            "STT_CLEANUP_TIMEOUT_SECONDS": "1",
            "SPRING_STATUS_CALLBACK_TIMEOUT_SECONDS": "0.75",
            "SPRING_STATUS_CALLBACK_ATTEMPTS": "2",
        }
    )

    with pytest.raises(RuntimeError, match="ceilings exceed"):
        settings.validate_agent_server()


def test_settings_repr_redacts_credentials_and_redis_password() -> None:
    configured = Settings.from_env(
        {
            **BASE_ENV,
            "LIVEKIT_API_KEY": "private-livekit-key",
            "LIVEKIT_API_SECRET": "private-livekit-secret",
            "REDIS_URL": "redis://:private-redis-password@redis:6379/0",
            "OPENAI_API_KEY": "private-openai-key",
            "AI_CALLBACK_SECRET": "private-callback-secret",
        }
    )

    rendered = repr(configured)
    assert "private-livekit-key" not in rendered
    assert "private-livekit-secret" not in rendered
    assert "private-redis-password" not in rendered
    assert "private-openai-key" not in rendered
    assert "private-callback-secret" not in rendered
