"""Validated runtime configuration. Startup fails on invalid values; there are no insecure fallbacks."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    app_env: Literal["development", "test", "production"]
    service_version: str = Field(default="0.0.0-dev", min_length=1)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    api_docs_enabled: bool = False
    otel_exporter_otlp_endpoint: str | None = None

    @model_validator(mode="after")
    def _production_rules(self) -> Self:
        if self.app_env == "production" and self.api_docs_enabled:
            raise ValueError("api_docs_enabled must be false in production")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # values come from the environment
