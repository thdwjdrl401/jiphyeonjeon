from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.database_urls import parse_async_database_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_WORKER_",
        extra="ignore",
        populate_by_name=True,
        validate_default=True,
    )

    environment: Literal["local", "test", "staging", "production"] = "local"
    instance_id: str = Field(min_length=1, max_length=128)
    management_host: str = "127.0.0.1"
    management_port: int = Field(default=8011, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    database_url: SecretStr
    material_ingestion_enabled: bool = False
    rabbitmq_url: SecretStr | None = Field(default=None, min_length=1)
    rabbitmq_retry_limit: int = Field(default=3, ge=0, le=10)
    rabbitmq_retry_base_delay_seconds: float = Field(default=5.0, ge=0, le=60)
    rabbitmq_shutdown_grace_seconds: float = Field(default=30.0, gt=0, le=600)
    tenant_id: str = Field(default="liveclass", min_length=1, max_length=128)
    spring_internal_base_url: str = "http://127.0.0.1:8080"
    spring_hmac_secret: SecretStr | None = Field(
        default=None,
        min_length=1,
        validation_alias=AliasChoices(
            "AI_CALLBACK_SECRET",
            "AI_WORKER_SPRING_HMAC_SECRET",
        ),
    )
    spring_url_issue_timeout_seconds: float = Field(default=5.0, gt=0, le=120)
    spring_download_timeout_seconds: float = Field(default=30.0, gt=0, le=600)
    spring_callback_timeout_seconds: float = Field(default=5.0, gt=0, le=120)
    bge_runtime_url: str = "http://127.0.0.1:8020"
    bge_internal_token: SecretStr | None = Field(default=None, min_length=32)
    bge_request_timeout_seconds: float = Field(default=10.0, gt=0, le=120)
    embedding_model: Literal["BAAI/bge-m3"] = "BAAI/bge-m3"
    embedding_revision: str = Field(
        default="5617a9f61b028005a4858fdac845db406aefb181",
        pattern=r"^[0-9a-f]{40}$",
    )
    embedding_max_batch_size: Literal[4] = 4
    embedding_max_text_chars: int = Field(default=4_000, ge=1, le=100_000)
    source_max_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    chunk_max_chars: int = Field(default=1_200, ge=100, le=10_000)

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        parse_async_database_url(value.get_secret_value())
        return value

    @field_validator("rabbitmq_url")
    @classmethod
    def validate_rabbitmq_url(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        revealed = value.get_secret_value()
        parsed = urlsplit(revealed)
        if (
            revealed != revealed.strip()
            or parsed.scheme not in {"amqp", "amqps"}
            or not parsed.hostname
            or parsed.fragment
        ):
            raise ValueError("rabbitmq_url must be an unpadded AMQP URL")
        try:
            parsed.port
        except ValueError as exc:
            raise ValueError("rabbitmq_url contains an invalid port") from exc
        return value

    @field_validator("tenant_id")
    @classmethod
    def validate_unpadded_tenant_id(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise ValueError("tenant_id must not be blank or padded")
        return value

    @field_validator("spring_internal_base_url", "bge_runtime_url")
    @classmethod
    def validate_internal_http_origin(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            value != value.strip()
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "internal service URL must be an HTTP origin without credentials or path"
            )
        try:
            parsed.port
        except ValueError as exc:
            raise ValueError("internal service URL contains an invalid port") from exc
        return value.rstrip("/")

    @field_validator("spring_hmac_secret", "bge_internal_token")
    @classmethod
    def validate_optional_secret(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        revealed = value.get_secret_value()
        if not revealed.strip() or revealed != revealed.strip():
            raise ValueError("secret values must not be blank or padded")
        return value


@lru_cache
def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
