from functools import lru_cache
import re
from typing import Literal, Self
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_API_", extra="ignore")

    environment: Literal["local", "test", "staging", "production"] = "local"
    host: str = "127.0.0.1"
    port: int = Field(default=8010, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    instance_id: str = Field(
        default="ai-api-1",
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )

    redis_url: str = Field(default="redis://127.0.0.1:6379/0", min_length=1)
    caption_stream_key: str = Field(default="ai:captions:live", min_length=1, max_length=256)
    caption_poll_block_ms: int = Field(default=1_000, ge=100, le=10_000)
    caption_batch_size: int = Field(default=100, ge=1, le=1_000)
    caption_context_lookback_ms: int = Field(default=300_000, ge=1, le=3_600_000)
    caption_context_max_events: int = Field(default=1_000, ge=1, le=100_000)
    caption_context_max_bytes: int = Field(default=1_048_576, ge=1_024, le=104_857_600)
    caption_context_max_sessions: int = Field(default=1_000, ge=1, le=100_000)
    caption_context_max_retired_attempts: int = Field(default=16, ge=1, le=1_000)
    redis_reconnect_min_seconds: float = Field(default=0.25, gt=0, le=30)
    redis_reconnect_max_seconds: float = Field(default=5.0, gt=0, le=300)
    redis_connect_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    redis_socket_timeout_seconds: float = Field(default=15.0, gt=0, le=120)

    database_url: str | None = None
    database_role: str = "ai_app"
    bge_base_url: str | None = None
    bge_token: SecretStr | None = Field(default=None, min_length=32)
    bge_model: str = "BAAI/bge-m3"
    bge_revision: str = Field(
        default="5617a9f61b028005a4858fdac845db406aefb181",
        pattern=r"^[0-9a-f]{40}$",
    )
    bge_timeout_seconds: float = Field(default=8.0, gt=0, le=120)

    gms_api_key: SecretStr | None = Field(default=None, min_length=1)
    gms_model: str = Field(default="gpt-4.1", min_length=1, max_length=128)
    gms_max_output_tokens: int = Field(default=1_024, ge=1, le=8_192)
    gms_max_prompt_chars: int = Field(default=100_000, ge=1_000, le=1_000_000)
    gms_timeout_seconds: float = Field(default=55.0, gt=0, le=120)

    rag_retrieval_timeout_seconds: float = Field(default=10.0, gt=0, le=120)
    rag_model_timeout_seconds: float = Field(default=60.0, gt=0, le=180)
    rag_request_max_active: int = Field(default=256, ge=1, le=10_000)
    rag_request_max_completed: int = Field(default=10_000, ge=1, le=1_000_000)
    caption_shutdown_timeout_seconds: float = Field(default=3.0, gt=0, le=30)
    caption_cancel_grace_seconds: float = Field(default=1.0, gt=0, le=10)

    material_top_k: int = Field(default=8, ge=1, le=50)
    material_vector_threshold: float = Field(default=0.25, ge=0, le=1)
    material_lexical_threshold: float = Field(default=0.0, ge=0, le=1)
    caption_evidence_max_items: int = Field(default=32, ge=1, le=1_000)
    caption_evidence_max_chars: int = Field(default=20_000, ge=1, le=50_000)

    @field_validator("gms_api_key", mode="before")
    @classmethod
    def validate_gms_api_key(cls, value: object) -> object:
        if isinstance(value, str):
            if not value.strip():
                return None
            if value != value.strip():
                raise ValueError("gms_api_key must not contain surrounding whitespace")
        return value

    @field_validator("gms_model")
    @classmethod
    def validate_gms_model(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("gms_model must not contain surrounding whitespace")
        return value

    @field_validator("database_role")
    @classmethod
    def validate_database_role(cls, value: str) -> str:
        if not _DATABASE_ROLE.fullmatch(value):
            raise ValueError("database_role must be a safe PostgreSQL role identifier")
        return value

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            url = make_url(value)
        except ArgumentError as exc:
            raise ValueError("database_url must be a valid SQLAlchemy URL") from exc
        if url.drivername != "postgresql+asyncpg" or not url.database:
            raise ValueError("database_url must use postgresql+asyncpg and name a database")
        return value

    @model_validator(mode="after")
    def validate_context_runtime(self) -> Self:
        if self.redis_reconnect_max_seconds < self.redis_reconnect_min_seconds:
            raise ValueError("redis reconnect maximum must be at least the minimum")
        if self.redis_socket_timeout_seconds <= self.caption_poll_block_ms / 1_000:
            raise ValueError("redis socket timeout must exceed caption poll block")
        if self.caption_shutdown_timeout_seconds <= self.caption_poll_block_ms / 1_000:
            raise ValueError("caption shutdown timeout must exceed caption poll block")

        redis_url = urlparse(self.redis_url)
        try:
            redis_port = redis_url.port
        except ValueError as exc:
            raise ValueError("redis_url is malformed") from exc
        if redis_url.scheme not in {"redis", "rediss"} or not redis_url.hostname:
            raise ValueError("redis_url must use redis:// or rediss://")
        if redis_port is not None and not 1 <= redis_port <= 65_535:
            raise ValueError("redis_url port is out of range")

        if (self.bge_base_url is None) != (self.bge_token is None):
            raise ValueError("bge_base_url and bge_token must be configured together")
        if self.bge_base_url is not None:
            bge_url = urlparse(self.bge_base_url)
            if (
                bge_url.scheme not in {"http", "https"}
                or not bge_url.hostname
                or bge_url.username is not None
                or bge_url.password is not None
                or bge_url.path not in {"", "/"}
                or bge_url.query
                or bge_url.fragment
            ):
                raise ValueError("bge_base_url must be a credential-free HTTP(S) origin")
        if self.rag_retrieval_timeout_seconds <= self.bge_timeout_seconds:
            raise ValueError("RAG retrieval timeout must exceed the BGE client timeout")
        if self.rag_model_timeout_seconds <= self.gms_timeout_seconds:
            raise ValueError("RAG model timeout must exceed the GMS client timeout")
        return self


@lru_cache
def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
