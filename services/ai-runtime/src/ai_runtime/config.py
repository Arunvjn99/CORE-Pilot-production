"""Validated runtime configuration. Startup fails on invalid values; there are no insecure fallbacks."""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip().lower() for item in value.split(",") if item.strip())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    app_env: Literal["development", "test", "production"]
    service_version: str = Field(default="0.0.0-dev", min_length=1)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    api_docs_enabled: bool = False
    otel_exporter_otlp_endpoint: str | None = None

    # Envelope decryption (ADR-0010). The runtime is the only component that can unwrap.
    credential_kek_provider: Literal["local", "azure-key-vault"] = "local"
    local_kek: str | None = None
    azure_key_vault_key_id: str | None = None

    # Service-to-service auth (ADR-0011): only the API's identity may call /internal routes.
    service_auth_issuer: str | None = None
    service_auth_audience: str | None = None
    service_auth_allowed_callers: str = ""

    # Egress (docs/security/provider-endpoint-ssrf.md).
    llm_endpoint_allowed_private_hosts: str = ""
    provider_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    @property
    def allowed_callers(self) -> tuple[str, ...]:
        return _csv(self.service_auth_allowed_callers)

    @property
    def allowed_private_hosts(self) -> tuple[str, ...]:
        return _csv(self.llm_endpoint_allowed_private_hosts)

    @property
    def service_auth_configured(self) -> bool:
        return bool(self.service_auth_issuer and self.service_auth_audience and self.allowed_callers)

    @model_validator(mode="after")
    def _production_rules(self) -> Self:
        if self.app_env != "production":
            return self
        problems: list[str] = []
        if self.api_docs_enabled:
            problems.append("api_docs_enabled must be false in production")
        if self.credential_kek_provider != "azure-key-vault" or not self.azure_key_vault_key_id:
            problems.append("production requires CREDENTIAL_KEK_PROVIDER=azure-key-vault and its key id")
        if self.local_kek:
            problems.append("LOCAL_KEK must not be set in production")
        if not self.service_auth_configured or not (self.service_auth_issuer or "").startswith("https://"):
            problems.append("production requires https SERVICE_AUTH_ISSUER, audience and allowed callers")
        if problems:
            raise ValueError("; ".join(problems))
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # values come from the environment
