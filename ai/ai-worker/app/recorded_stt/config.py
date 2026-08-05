from __future__ import annotations

from functools import lru_cache
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RecordedSttSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RECORDED_STT_",
        extra="ignore",
        validate_default=True,
    )

    environment: Literal["local", "test", "staging", "production"] = "local"
    instance_id: str = Field(min_length=1, max_length=128)
    management_host: str = "127.0.0.1"
    management_port: int = Field(default=8012, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    rabbitmq_url: SecretStr
    rabbitmq_retry_limit: int = Field(default=3, ge=0, le=10)
    rabbitmq_retry_base_delay_seconds: float = Field(default=5.0, ge=0, le=60)
    shutdown_grace_seconds: float = Field(default=45.0, gt=0, le=600)

    spring_internal_base_url: str = "http://127.0.0.1:8080"
    source_hmac_secret: SecretStr
    callback_hmac_secret: SecretStr
    spring_timeout_seconds: float = Field(default=10.0, gt=0, le=120)
    source_download_timeout_seconds: float = Field(default=600.0, gt=0, le=3600)
    source_max_bytes: int = Field(default=5 * 1024 * 1024 * 1024, gt=0)
    source_max_duration_seconds: int = Field(default=6 * 60 * 60, ge=60, le=24 * 60 * 60)

    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: SecretStr
    model: Literal["whisper-1"] = "whisper-1"
    language: Literal["ko"] = "ko"
    request_timeout_seconds: float = Field(default=180.0, gt=0, le=900)
    openai_retry_limit: int = Field(default=3, ge=0, le=10)
    openai_retry_base_delay_seconds: float = Field(default=2.0, ge=0, le=60)

    cue_max_duration_ms: int = Field(default=6000, ge=1000, le=15_000)
    cue_max_chars: int = Field(default=42, ge=10, le=200)
    cue_pause_break_ms: int = Field(default=500, ge=100, le=5000)

    chunk_seconds: int = Field(default=900, ge=60, le=1800)
    chunk_overlap_ms: int = Field(default=1000, ge=0, le=10_000)
    chunk_max_bytes: int = Field(default=24 * 1024 * 1024, gt=0, le=24 * 1024 * 1024)
    ffmpeg_binary: str = Field(default="ffmpeg", min_length=1, max_length=255)
    ffprobe_binary: str = Field(default="ffprobe", min_length=1, max_length=255)

    @field_validator("rabbitmq_url")
    @classmethod
    def validate_rabbitmq_url(cls, value: SecretStr) -> SecretStr:
        revealed = value.get_secret_value()
        parsed = urlsplit(revealed)
        if (
            revealed != revealed.strip()
            or parsed.scheme not in {"amqp", "amqps"}
            or not parsed.hostname
        ):
            raise ValueError("rabbitmq_url must be an unpadded AMQP URL")
        return value

    @field_validator("spring_internal_base_url", "openai_base_url")
    @classmethod
    def validate_http_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            value != value.strip()
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("service URL must be a credential-free HTTP URL")
        return value.rstrip("/")

    @field_validator("source_hmac_secret", "callback_hmac_secret", "openai_api_key")
    @classmethod
    def validate_secret(cls, value: SecretStr) -> SecretStr:
        revealed = value.get_secret_value()
        if not revealed.strip() or revealed != revealed.strip():
            raise ValueError("secret values must not be blank or padded")
        return value

    @field_validator("ffmpeg_binary", "ffprobe_binary")
    @classmethod
    def validate_binary_name(cls, value: str) -> str:
        if value != value.strip() or "\x00" in value:
            raise ValueError("binary path must not be padded or contain NUL")
        return value

    @model_validator(mode="after")
    def validate_chunk_policy(self) -> Self:
        if self.chunk_overlap_ms >= self.chunk_seconds * 1000:
            raise ValueError("chunk overlap must be shorter than a chunk")
        if self.cue_pause_break_ms >= self.cue_max_duration_ms:
            raise ValueError("cue pause boundary must be shorter than the maximum cue duration")
        return self


@lru_cache
def load_recorded_stt_settings() -> RecordedSttSettings:
    return RecordedSttSettings()  # type: ignore[call-arg]
