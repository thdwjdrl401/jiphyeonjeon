from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_WORKER_", extra="ignore")

    environment: Literal["local", "test", "staging", "production"] = "local"
    instance_id: str = Field(min_length=1, max_length=128)
    management_host: str = "127.0.0.1"
    management_port: int = Field(default=8011, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


@lru_cache
def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
