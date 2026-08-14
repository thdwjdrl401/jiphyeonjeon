from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.embedding import BGE_M3_MODEL, BGE_M3_REVISION, parse_device


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BGE_RUNTIME_",
        extra="ignore",
        validate_default=True,
    )

    host: str = "127.0.0.1"
    port: int = Field(default=8020, ge=1, le=65535)
    internal_token: SecretStr = Field(min_length=32)
    model: str = Field(default=BGE_M3_MODEL, min_length=1)
    revision: str = Field(default=BGE_M3_REVISION, pattern=r"^[0-9a-f]{40}$")
    device: str = "cuda"
    batch_size: int = Field(default=4, ge=1, le=32)
    max_batch_size: int = Field(default=4, ge=1, le=64)
    max_inflight_requests: int = Field(default=8, ge=1, le=64)
    max_text_chars: int = Field(default=4_000, ge=1, le=100_000)
    max_request_body_bytes: int = Field(default=128 * 1024, ge=1, le=16 * 1024 * 1024)
    request_body_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("device")
    @classmethod
    def validate_device(cls, device: str) -> str:
        return parse_device(device)

    @field_validator("host", "model")
    @classmethod
    def validate_nonblank_string(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise ValueError("value must not be blank or have surrounding whitespace")
        return value

    @field_validator("internal_token")
    @classmethod
    def validate_internal_token(cls, token: SecretStr) -> SecretStr:
        value = token.get_secret_value()
        if not value.strip() or value != value.strip():
            raise ValueError("internal_token must not be blank or have surrounding whitespace")
        return token

    @model_validator(mode="after")
    def validate_batch_sizes(self) -> Self:
        if self.batch_size > self.max_batch_size:
            raise ValueError("batch_size must not exceed max_batch_size")
        return self


@lru_cache
def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
