"""Internal gateway routes. Only the API service identity may call them (service_auth)."""

import base64
from functools import lru_cache
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from ai_runtime.config import Settings, get_settings
from ai_runtime.gateway.egress import EgressPolicy, egress_client
from ai_runtime.gateway.providers import Provider, ProviderTarget, probe
from ai_runtime.service_auth import require_service_caller
from ai_runtime.vault.azure import AzureKeyVaultUnwrapper
from ai_runtime.vault.envelope import (
    CredentialDecryptionError,
    KeyUnwrapper,
    LocalKeyUnwrapper,
    SealedCredential,
    open_sealed,
)

_log = structlog.get_logger()


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", frozen=True)


class SealedPayload(_Camel):
    kind: Literal["team", "platform"]
    credential_id: str = Field(min_length=36, max_length=36)
    envelope_version: int
    ciphertext: str = Field(max_length=16384)
    iv: str = Field(max_length=64)
    auth_tag: str = Field(max_length=64)
    wrapped_dek: str = Field(max_length=4096)
    kek_id: str = Field(max_length=500)
    kek_version: str = Field(max_length=200)
    wrap_algorithm: str = Field(max_length=50)


class ProbeRequest(_Camel):
    provider: Provider
    endpoint: str | None = Field(default=None, max_length=500)
    api_version: str | None = Field(default=None, max_length=50)
    deployment: str | None = Field(default=None, max_length=200)
    sealed: SealedPayload | None = None


class ProbeResponse(_Camel):
    code: str
    message: str
    latency_ms: int
    models: list[str]


@lru_cache(maxsize=1)
def _unwrapper(settings: Settings) -> KeyUnwrapper:
    if settings.credential_kek_provider == "azure-key-vault":
        return AzureKeyVaultUnwrapper(settings.azure_key_vault_key_id or "")
    if not settings.local_kek:
        raise CredentialDecryptionError("no key-encryption key configured")
    return LocalKeyUnwrapper(settings.local_kek)


def _sealed(payload: SealedPayload) -> SealedCredential:
    def b(value: str) -> bytes:
        return base64.b64decode(value, validate=True)

    return SealedCredential(
        kind=payload.kind,
        credential_id=payload.credential_id,
        envelope_version=payload.envelope_version,
        ciphertext=b(payload.ciphertext),
        iv=b(payload.iv),
        auth_tag=b(payload.auth_tag),
        wrapped_dek=b(payload.wrapped_dek),
        kek_id=payload.kek_id,
        kek_version=payload.kek_version,
        wrap_algorithm=payload.wrap_algorithm,
    )


router = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_service_caller)])


@router.post("/providers/probe", response_model=ProbeResponse, response_model_by_alias=True)
async def probe_provider(
    body: ProbeRequest, settings: Annotated[Settings, Depends(get_settings)]
) -> ProbeResponse:
    secret: str | None = None
    if body.sealed is not None:
        try:
            secret = open_sealed(_sealed(body.sealed), _unwrapper(settings))
        except (CredentialDecryptionError, ValueError):
            _log.warning("probe_decrypt_failed", provider=body.provider)
            return ProbeResponse(
                code="credential_unavailable",
                message="The stored credential could not be decrypted",
                latency_ms=0,
                models=[],
            )
    policy = EgressPolicy(
        allow_private=settings.app_env != "production",
        allowed_private_hosts=settings.allowed_private_hosts,
        require_https=settings.app_env == "production",
    )
    target = ProviderTarget(body.provider, secret, body.endpoint, body.api_version, body.deployment)
    async with egress_client(policy, settings.provider_timeout_seconds) as client:
        result = await probe(client, target)
    del secret
    _log.info("provider_probe", provider=body.provider, code=result.code, latency_ms=result.latency_ms)
    return ProbeResponse(
        code=result.code, message=result.message, latency_ms=result.latency_ms, models=list(result.models)
    )
