from __future__ import annotations

import math
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from urllib.parse import urlparse, urlsplit

from app.connections import LiveKitConnectionSettings, RedisConnectionSettings

_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_REDIS_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_MAX_SHUTDOWN_TIMEOUT_SECONDS = 13.0
_CALLBACK_RETRY_BASE_DELAY_SECONDS = 0.1


def _parse_bool(environ: Mapping[str, str], name: str, default: bool) -> bool:
    raw = environ.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes"}:
        return True
    if value in {"0", "false", "no"}:
        return False
    raise ValueError(f"{name} must be true or false")


def _parse_int(environ: Mapping[str, str], name: str, default: int) -> int:
    raw = environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _parse_optional_int(environ: Mapping[str, str], name: str) -> int | None:
    raw = environ.get(name)
    if raw is None or not raw.strip():
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _parse_float(environ: Mapping[str, str], name: str, default: float) -> float:
    raw = environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc


def _validate_turn_url(value: str) -> None:
    if any(character.isspace() for character in value):
        raise RuntimeError("LIVEKIT_TURN_URL must not contain whitespace")
    scheme, separator, remainder = value.partition(":")
    if separator != ":" or scheme not in {"turn", "turns"}:
        raise RuntimeError("LIVEKIT_TURN_URL must use turn or turns")
    authority = remainder.partition("?")[0]
    parsed = urlsplit(f"//{authority}")
    try:
        port = parsed.port
    except ValueError as exc:
        raise RuntimeError("LIVEKIT_TURN_URL must include a valid host and port") from exc
    if (
        not parsed.hostname
        or port is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.fragment
    ):
        raise RuntimeError("LIVEKIT_TURN_URL must include a valid host and port")


@dataclass(frozen=True, slots=True)
class Settings:
    livekit_url: str
    livekit_api_key: str = field(repr=False)
    livekit_api_secret: str = field(repr=False)
    livekit_turn_url: str = ""
    livekit_turn_secret: str = field(default="", repr=False)
    agent_name: str = "liveclass-realtime-stt"
    stt_provider: str = ""
    health_host: str = "127.0.0.1"
    health_port: int = 8081
    max_active_jobs: int | None = None
    num_idle_processes: int | None = None
    redis_url: str = field(default="redis://localhost:6379/0", repr=False)
    redis_username: str = field(default="", repr=False)
    redis_password: str = field(default="", repr=False)
    redis_stream_key: str = "ai:captions:live"
    caption_stream_maxlen: int = 10_000
    session_lease_ttl_seconds: int = 30
    stt_shutdown_timeout_seconds: float = 12.0
    stt_drain_timeout_seconds: float = 7.0
    stt_cleanup_timeout_seconds: float = 1.0
    caption_publish_timeout_seconds: float = 1.25
    redis_operation_timeout_seconds: float = 1.0
    spring_status_callback_enabled: bool = False
    spring_status_callback_url: str = ""
    spring_status_callback_secret: str = field(default="", repr=False)
    spring_status_callback_timeout_seconds: float = 0.75
    spring_status_callback_attempts: int = 2
    openai_api_key: str = field(default="", repr=False)
    openai_realtime_model: str = "gpt-realtime-whisper"
    openai_realtime_delay: str = "low"
    nemotron_model_id: str = "nvidia/nemotron-3.5-asr-streaming-0.6b"
    asr_language: str = "ko-KR"

    def livekit_connection(self) -> LiveKitConnectionSettings:
        return LiveKitConnectionSettings(
            url=self.livekit_url,
            api_key=self.livekit_api_key,
            api_secret=self.livekit_api_secret,
        )

    def redis_connection(self) -> RedisConnectionSettings:
        return RedisConnectionSettings(
            url=self.redis_url,
            username=self.redis_username,
            password=self.redis_password,
        )

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        values = os.environ if environ is None else environ
        return cls(
            livekit_url=values.get("LIVEKIT_URL", ""),
            livekit_api_key=values.get("LIVEKIT_API_KEY", ""),
            livekit_api_secret=values.get("LIVEKIT_API_SECRET", ""),
            livekit_turn_url=values.get("LIVEKIT_TURN_URL", "").strip(),
            livekit_turn_secret=values.get("LIVEKIT_TURN_SECRET", ""),
            agent_name=values.get("STT_AGENT_NAME", "liveclass-realtime-stt"),
            stt_provider=values.get("STT_ENGINE_PROVIDER", ""),
            health_host=values.get("STT_HEALTH_HOST", "127.0.0.1").strip(),
            health_port=_parse_int(values, "STT_HEALTH_PORT", 8081),
            max_active_jobs=_parse_optional_int(values, "STT_MAX_ACTIVE_JOBS"),
            num_idle_processes=_parse_optional_int(values, "STT_NUM_IDLE_PROCESSES"),
            redis_url=values.get("REDIS_URL", "redis://localhost:6379/0"),
            redis_username=values.get("REDIS_USERNAME", ""),
            redis_password=values.get("REDIS_PASSWORD", ""),
            redis_stream_key=values.get("CAPTION_STREAM_KEY", "ai:captions:live"),
            caption_stream_maxlen=_parse_int(values, "CAPTION_STREAM_MAXLEN", 10_000),
            session_lease_ttl_seconds=_parse_int(values, "SESSION_LEASE_TTL_SECONDS", 30),
            stt_shutdown_timeout_seconds=_parse_float(values, "STT_SHUTDOWN_TIMEOUT_SECONDS", 12.0),
            stt_drain_timeout_seconds=_parse_float(values, "STT_DRAIN_TIMEOUT_SECONDS", 7.0),
            stt_cleanup_timeout_seconds=_parse_float(values, "STT_CLEANUP_TIMEOUT_SECONDS", 1.0),
            caption_publish_timeout_seconds=_parse_float(
                values, "CAPTION_PUBLISH_TIMEOUT_SECONDS", 1.25
            ),
            redis_operation_timeout_seconds=_parse_float(
                values, "REDIS_OPERATION_TIMEOUT_SECONDS", 1.0
            ),
            spring_status_callback_enabled=_parse_bool(
                values, "SPRING_STATUS_CALLBACK_ENABLED", False
            ),
            spring_status_callback_url=values.get("SPRING_STATUS_CALLBACK_URL", ""),
            spring_status_callback_secret=values.get("AI_CALLBACK_SECRET", ""),
            spring_status_callback_timeout_seconds=_parse_float(
                values, "SPRING_STATUS_CALLBACK_TIMEOUT_SECONDS", 0.75
            ),
            spring_status_callback_attempts=_parse_int(
                values, "SPRING_STATUS_CALLBACK_ATTEMPTS", 2
            ),
            openai_api_key=values.get("OPENAI_API_KEY", ""),
            openai_realtime_model=values.get(
                "OPENAI_REALTIME_TRANSCRIPTION_MODEL", "gpt-realtime-whisper"
            ),
            openai_realtime_delay=values.get("OPENAI_REALTIME_TRANSCRIPTION_DELAY", "low"),
            nemotron_model_id=values.get("ASR_MODEL_ID", "nvidia/nemotron-3.5-asr-streaming-0.6b"),
            asr_language=values.get("ASR_LANGUAGE", "ko-KR"),
        )

    def validate_agent_server(self) -> None:
        self.livekit_connection().validate()
        missing = [
            name
            for name, value in (
                ("STT_AGENT_NAME", self.agent_name),
                ("STT_ENGINE_PROVIDER", self.stt_provider),
                ("REDIS_URL", self.redis_url),
                ("CAPTION_STREAM_KEY", self.redis_stream_key),
            )
            if not value.strip()
        ]
        if missing:
            raise RuntimeError(f"missing required agent server settings: {', '.join(missing)}")

        if self.livekit_turn_url:
            _validate_turn_url(self.livekit_turn_url)
            if not self.livekit_turn_secret.strip():
                raise RuntimeError("LIVEKIT_TURN_SECRET is required when LIVEKIT_TURN_URL is set")
        self.redis_connection().validate()
        if not _SAFE_NAME.fullmatch(self.agent_name):
            raise RuntimeError("STT_AGENT_NAME must be a 1-128 character safe identifier")
        if not _SAFE_REDIS_KEY.fullmatch(self.redis_stream_key):
            raise RuntimeError("CAPTION_STREAM_KEY must be a 1-256 character safe Redis key")
        if self.health_host != "127.0.0.1":
            raise RuntimeError("STT_HEALTH_HOST must be 127.0.0.1")
        if isinstance(self.health_port, bool) or not isinstance(self.health_port, int):
            raise TypeError("STT_HEALTH_PORT must be an integer")
        if not 1 <= self.health_port <= 65535:
            raise RuntimeError("STT_HEALTH_PORT must be between 1 and 65535")
        if isinstance(self.caption_stream_maxlen, bool) or not isinstance(
            self.caption_stream_maxlen, int
        ):
            raise TypeError("CAPTION_STREAM_MAXLEN must be a positive integer")
        if self.caption_stream_maxlen <= 0:
            raise RuntimeError("CAPTION_STREAM_MAXLEN must be a positive integer")
        if self.max_active_jobs is not None:
            if isinstance(self.max_active_jobs, bool) or not isinstance(self.max_active_jobs, int):
                raise TypeError("STT_MAX_ACTIVE_JOBS must be an integer")
            if not 1 <= self.max_active_jobs <= 100:
                raise RuntimeError("STT_MAX_ACTIVE_JOBS must be between 1 and 100")
        if self.num_idle_processes is not None:
            if isinstance(self.num_idle_processes, bool) or not isinstance(
                self.num_idle_processes, int
            ):
                raise TypeError("STT_NUM_IDLE_PROCESSES must be an integer")
            if self.num_idle_processes < 1:
                raise RuntimeError("STT_NUM_IDLE_PROCESSES must be at least 1")
            if self.max_active_jobs is not None and self.num_idle_processes > self.max_active_jobs:
                raise RuntimeError("STT_NUM_IDLE_PROCESSES must not exceed STT_MAX_ACTIVE_JOBS")
        if self.session_lease_ttl_seconds < 3:
            raise RuntimeError("SESSION_LEASE_TTL_SECONDS must be at least 3")
        timeout_settings = (
            ("STT_SHUTDOWN_TIMEOUT_SECONDS", self.stt_shutdown_timeout_seconds),
            ("STT_DRAIN_TIMEOUT_SECONDS", self.stt_drain_timeout_seconds),
            ("STT_CLEANUP_TIMEOUT_SECONDS", self.stt_cleanup_timeout_seconds),
            ("CAPTION_PUBLISH_TIMEOUT_SECONDS", self.caption_publish_timeout_seconds),
            ("REDIS_OPERATION_TIMEOUT_SECONDS", self.redis_operation_timeout_seconds),
            (
                "SPRING_STATUS_CALLBACK_TIMEOUT_SECONDS",
                self.spring_status_callback_timeout_seconds,
            ),
        )
        for name, value in timeout_settings:
            if isinstance(value, bool) or not isinstance(value, int | float):
                raise TypeError(f"{name} must be a finite positive number")
            if not math.isfinite(value) or value <= 0:
                raise RuntimeError(f"{name} must be a finite positive number")
        if self.stt_shutdown_timeout_seconds > _MAX_SHUTDOWN_TIMEOUT_SECONDS:
            raise RuntimeError(
                "STT_SHUTDOWN_TIMEOUT_SECONDS must be at most 13 seconds "
                "to leave headroom before LiveKit's 15-second cancellation"
            )
        if self.stt_drain_timeout_seconds > self.stt_shutdown_timeout_seconds:
            raise RuntimeError(
                "STT_DRAIN_TIMEOUT_SECONDS must not exceed STT_SHUTDOWN_TIMEOUT_SECONDS"
            )
        if self.stt_cleanup_timeout_seconds > self.stt_shutdown_timeout_seconds:
            raise RuntimeError(
                "STT_CLEANUP_TIMEOUT_SECONDS must not exceed STT_SHUTDOWN_TIMEOUT_SECONDS"
            )
        if self.caption_publish_timeout_seconds > self.stt_drain_timeout_seconds:
            raise RuntimeError(
                "CAPTION_PUBLISH_TIMEOUT_SECONDS must not exceed STT_DRAIN_TIMEOUT_SECONDS"
            )
        if self.redis_operation_timeout_seconds > self.stt_cleanup_timeout_seconds:
            raise RuntimeError(
                "REDIS_OPERATION_TIMEOUT_SECONDS must not exceed STT_CLEANUP_TIMEOUT_SECONDS"
            )
        if not 1 <= self.spring_status_callback_attempts <= 5:
            raise RuntimeError("SPRING_STATUS_CALLBACK_ATTEMPTS must be between 1 and 5")

        callback_budget = 0.0
        if self.spring_status_callback_enabled:
            callback_budget = (
                self.spring_status_callback_timeout_seconds * self.spring_status_callback_attempts
                + _CALLBACK_RETRY_BASE_DELAY_SECONDS
                * (2 ** (self.spring_status_callback_attempts - 1) - 1)
            )
        # room_job cleanup and outer lease/reporter cleanup are separate phases. Their
        # configured ceilings plus drain/callback must fit inside the one absolute budget.
        configured_shutdown_path = (
            self.stt_drain_timeout_seconds
            + 2 * self.stt_cleanup_timeout_seconds
            + self.caption_publish_timeout_seconds
            + callback_budget
        )
        if configured_shutdown_path > self.stt_shutdown_timeout_seconds:
            raise RuntimeError(
                "configured drain, cleanup, caption, and callback ceilings exceed "
                "STT_SHUTDOWN_TIMEOUT_SECONDS"
            )

        if not self.asr_language.strip() or len(self.asr_language) > 32:
            raise RuntimeError("ASR_LANGUAGE must contain 1-32 characters")

        if not self.spring_status_callback_enabled:
            return
        callback_missing = [
            name
            for name, value in (
                ("SPRING_STATUS_CALLBACK_URL", self.spring_status_callback_url),
                ("AI_CALLBACK_SECRET", self.spring_status_callback_secret),
            )
            if not value.strip()
        ]
        if callback_missing:
            raise RuntimeError("missing required callback settings: " + ", ".join(callback_missing))
        callback_url = urlparse(self.spring_status_callback_url)
        if callback_url.scheme not in {"http", "https"} or not callback_url.netloc:
            raise RuntimeError("SPRING_STATUS_CALLBACK_URL must use http or https")
        if len(self.spring_status_callback_secret.encode("utf-8")) < 32:
            raise RuntimeError("AI_CALLBACK_SECRET must be at least 32 bytes")
