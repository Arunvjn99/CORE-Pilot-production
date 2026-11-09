"""Provider adapters for connection probes and model discovery.

Probes call each vendor's model-listing endpoint: it proves the key and endpoint work without
spending tokens. Completion calls (later slices) go through LiteLLM behind the same interface.
Upstream response bodies are never returned to callers; failures map to a fixed code set.
"""

import time
from dataclasses import dataclass
from typing import Literal

import httpx2

from ai_runtime.gateway.egress import EgressBlockedError, read_json_capped

Provider = Literal["openai", "anthropic", "gemini", "azure_openai", "ollama"]
ProbeCode = Literal[
    "ok",
    "unauthorized",
    "not_found",
    "rate_limited",
    "provider_error",
    "unreachable",
    "timeout",
    "endpoint_blocked",
    "credential_unavailable",
    "invalid_response",
]

MESSAGES: dict[ProbeCode, str] = {
    "ok": "Connected",
    "unauthorized": "The provider rejected the API key",
    "not_found": "The endpoint, deployment or API version was not found",
    "rate_limited": "The provider is rate limiting this key; try again later",
    "provider_error": "The provider returned an error",
    "unreachable": "Could not connect to the provider endpoint",
    "timeout": "The provider did not respond in time",
    "endpoint_blocked": "The endpoint resolves to an address that is not allowed",
    "credential_unavailable": "The stored credential could not be decrypted",
    "invalid_response": "The provider returned an unexpected response",
}

MAX_MODELS = 500


@dataclass(frozen=True, slots=True)
class ProviderTarget:
    provider: Provider
    secret: str | None
    endpoint: str | None
    api_version: str | None
    deployment: str | None


@dataclass(frozen=True, slots=True)
class ProbeResult:
    code: ProbeCode
    latency_ms: int
    models: tuple[str, ...]

    @property
    def message(self) -> str:
        return MESSAGES[self.code]


def _base(target: ProviderTarget) -> str:
    if not target.endpoint:
        raise ValueError("endpoint required")
    return target.endpoint.rstrip("/")


def _request(target: ProviderTarget, client: httpx2.AsyncClient) -> httpx2.Request:
    secret = target.secret or ""
    match target.provider:
        case "openai":
            return client.build_request(
                "GET", "https://api.openai.com/v1/models", headers={"authorization": f"Bearer {secret}"}
            )
        case "anthropic":
            return client.build_request(
                "GET",
                "https://api.anthropic.com/v1/models",
                params={"limit": "1000"},
                headers={"x-api-key": secret, "anthropic-version": "2023-06-01"},
            )
        case "gemini":
            return client.build_request(
                "GET",
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"pageSize": "1000"},
                headers={"x-goog-api-key": secret},
            )
        case "azure_openai":
            return client.build_request(
                "GET",
                f"{_base(target)}/openai/models",
                params={"api-version": target.api_version or ""},
                headers={"api-key": secret},
            )
        case "ollama":
            headers = {"authorization": f"Bearer {secret}"} if secret else {}
            return client.build_request("GET", f"{_base(target)}/api/tags", headers=headers)


def _models(target: ProviderTarget, payload: object) -> tuple[str, ...]:
    if not isinstance(payload, dict):
        raise TypeError("unexpected payload")
    names: list[str] = []
    match target.provider:
        case "openai" | "anthropic":
            names = [str(item["id"]) for item in payload["data"]]
        case "gemini":
            names = [
                str(item["name"]).removeprefix("models/")
                for item in payload["models"]
                if "generateContent" in item.get("supportedGenerationMethods", [])
            ]
        case "azure_openai":
            # Callers invoke the deployment, not the base model; the listing only proves access.
            names = [target.deployment] if target.deployment else []
        case "ollama":
            names = [str(item["name"]) for item in payload["models"]]
    return tuple(sorted(set(names))[:MAX_MODELS])


def _status_code(provider: Provider, status: int) -> ProbeCode:
    # Gemini answers an invalid key with 400 API_KEY_INVALID on the model listing.
    if status in (401, 403) or (provider == "gemini" and status == 400):
        return "unauthorized"
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    return "provider_error"


async def probe(client: httpx2.AsyncClient, target: ProviderTarget) -> ProbeResult:
    started = time.monotonic()

    def done(code: ProbeCode, models: tuple[str, ...] = ()) -> ProbeResult:
        return ProbeResult(code, int((time.monotonic() - started) * 1000), models)

    try:
        response = await client.send(_request(target, client), stream=True)
        try:
            if response.status_code != 200:
                return done(_status_code(target.provider, response.status_code))
            payload = await read_json_capped(response)
        finally:
            await response.aclose()
        return done("ok", _models(target, payload))
    except EgressBlockedError:
        return done("endpoint_blocked")
    except httpx2.TimeoutException:
        return done("timeout")
    except httpx2.TransportError:
        return done("unreachable")
    except (ValueError, KeyError, TypeError):
        return done("invalid_response")
