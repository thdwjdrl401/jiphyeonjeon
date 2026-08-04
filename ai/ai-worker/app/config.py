from functools import lru_cache
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.database_urls import parse_async_database_url


def _validate_internal_http_url(value: str, *, allow_path: bool) -> str:
    parsed = urlsplit(value)
    path_ok = parsed.path in {"", "/"} if not allow_path else ".." not in parsed.path.split("/")
    if (
        value != value.strip()
        or parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or not path_ok
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "internal service URL must be a credential-free HTTP origin"
            + ("" if allow_path else " without a path")
        )
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("internal service URL contains an invalid port") from exc
    return value.rstrip("/") if parsed.path in {"", "/"} else value


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
    bge_readiness_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    embedding_model: Literal["BAAI/bge-m3"] = "BAAI/bge-m3"
    embedding_revision: str = Field(
        default="5617a9f61b028005a4858fdac845db406aefb181",
        pattern=r"^[0-9a-f]{40}$",
    )
    embedding_max_batch_size: Literal[4] = 4
    embedding_max_text_chars: int = Field(default=4_000, ge=1, le=100_000)
    source_max_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    chunk_max_chars: int = Field(default=1_200, ge=100, le=10_000)

    key_term_extraction_enabled: bool = False
    annotation_ingestion_enabled: bool = False
    annotation_image_max_bytes: int = Field(default=4 * 1024 * 1024, gt=0)
    gms_api_key: SecretStr | None = Field(default=None, min_length=1)
    gms_model: str = Field(default="gpt-4.1", min_length=1, max_length=128)
    # Reading a highlight image needs a vision model; extracting key terms from PPTX text does
    # not. Unset falls back to gms_model so nothing changes for deployments that do not care.
    annotation_model: str | None = Field(default=None, min_length=1, max_length=128)
    gms_max_output_tokens: int = Field(default=1_024, ge=1, le=8_192)
    gms_max_prompt_chars: int = Field(default=100_000, ge=1_000, le=1_000_000)
    gms_timeout_seconds: float = Field(default=55.0, gt=0, le=120)

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

    @field_validator("spring_internal_base_url")
    @classmethod
    def validate_spring_internal_base_url(cls, value: str) -> str:
        return _validate_internal_http_url(value, allow_path=False)

    @field_validator("bge_runtime_url")
    @classmethod
    def validate_bge_runtime_url(cls, value: str) -> str:
        # bge-runtime may sit behind a reverse-proxy path prefix (e.g. GPU tunnel
        # exposed as /internal/bge/ on a shared nginx port) instead of its own origin.
        # httpx merges a leading-slash request path onto this base regardless of
        # trailing slash, so any well-formed path is safe to allow here.
        return _validate_internal_http_url(value, allow_path=True)

    @field_validator("spring_hmac_secret", "bge_internal_token", "gms_api_key")
    @classmethod
    def validate_optional_secret(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        revealed = value.get_secret_value()
        if not revealed.strip() or revealed != revealed.strip():
            raise ValueError("secret values must not be blank or padded")
        return value

    @field_validator("gms_model")
    @classmethod
    def validate_gms_model(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("gms_model must not contain surrounding whitespace")
        return value

    @field_validator("annotation_model", mode="before")
    @classmethod
    def validate_annotation_model(cls, value: object) -> object:
        # Blank means "not configured" rather than an empty model name, so an env file that
        # declares the key without a value still falls back instead of failing to start.
        if isinstance(value, str):
            if not value.strip():
                return None
            if value != value.strip():
                raise ValueError("annotation_model must not contain surrounding whitespace")
        return value

    @model_validator(mode="after")
    def validate_key_term_extraction(self) -> Self:
        if self.key_term_extraction_enabled and self.gms_api_key is None:
            raise ValueError("key_term_extraction_enabled requires gms_api_key")
        return self

    @model_validator(mode="after")
    def validate_annotation_ingestion(self) -> Self:
        # Spring may send snapshots with no interpretation of its own, and those can only be
        # indexed by reading the image — so the model key is required up front rather than
        # letting individual jobs fail at runtime (ADR-0043 §3).
        if self.annotation_ingestion_enabled and self.gms_api_key is None:
            raise ValueError("annotation_ingestion_enabled requires gms_api_key")
        return self


@lru_cache
def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
