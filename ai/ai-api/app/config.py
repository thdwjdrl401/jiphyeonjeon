from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_API_", extra="ignore")

    environment: Literal["local", "test", "staging", "production"] = "local"
    host: str = "127.0.0.1"
    port: int = Field(default=8010, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


@lru_cache
def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
