import json
import time
from pathlib import Path
from typing import Any

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from ai_runtime import service_auth
from ai_runtime.app import create_app
from ai_runtime.config import Settings
from ai_runtime.gateway import egress, router
from ai_runtime.gateway.egress import EgressBlockedError, EgressPolicy, PinnedTransport, is_blocked_address
from ai_runtime.gateway.providers import ProviderTarget, probe

ROOT = Path(__file__).resolve().parents[3]
CASES = json.loads((ROOT / "packages/contracts/test-vectors/egress-address-cases.json").read_text())
VECTOR = json.loads((ROOT / "packages/contracts/test-vectors/credential-envelope-v1.json").read_text())

ISSUER = "https://idp.test/default"
AUDIENCE = "api://core-ai-runtime"
CALLER = "core-api"


# ---------- address classification (parity with apps/api endpoint-policy) ----------


@pytest.mark.parametrize("address", CASES["blocked"])
def test_blocks_non_public_addresses(address: str) -> None:
    assert is_blocked_address(address)


@pytest.mark.parametrize("address", CASES["allowed"])
def test_allows_public_addresses(address: str) -> None:
    assert not is_blocked_address(address)


# ---------- pinned transport ----------


class Recorder(httpx2.AsyncBaseTransport):
    def __init__(self, status: int = 200, body: Any = None) -> None:
        self.requests: list[httpx2.Request] = []
        self.status = status
        self.body = body if body is not None else {"data": []}

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return httpx2.Response(self.status, json=self.body)


def resolve_to(monkeypatch: pytest.MonkeyPatch, mapping: dict[str, list[str]]) -> None:
    async def fake(host: str, port: int) -> list[str]:
        return mapping.get(host, [host])

    monkeypatch.setattr(egress, "_resolve", fake)


async def send(transport: PinnedTransport, url: str) -> httpx2.Response:
    async with httpx2.AsyncClient(transport=transport, follow_redirects=False) as client:
        return await client.get(url)


@pytest.mark.anyio
async def test_dns_rebinding_to_private_address_is_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve_to(monkeypatch, {"rebind.example.com": ["93.184.216.34", "169.254.169.254"]})
    inner = Recorder()
    with pytest.raises(EgressBlockedError):
        await send(PinnedTransport(EgressPolicy(allow_private=False), inner), "https://rebind.example.com/")
    assert inner.requests == []


@pytest.mark.anyio
async def test_connection_is_pinned_to_checked_address_with_sni(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve_to(monkeypatch, {"api.example.com": ["93.184.216.34"]})
    inner = Recorder()
    await send(PinnedTransport(EgressPolicy(allow_private=False), inner), "https://api.example.com/v1")
    sent = inner.requests[0]
    assert sent.url.host == "93.184.216.34"
    assert sent.headers["host"] == "api.example.com"
    assert sent.extensions["sni_hostname"] == "api.example.com"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("url", "policy"),
    [
        ("http://api.example.com/", EgressPolicy(allow_private=False, require_https=True)),
        ("https://u:p@api.example.com/", EgressPolicy(allow_private=True, require_https=False)),
        ("https://10.0.0.5/", EgressPolicy(allow_private=False)),
    ],
)
async def test_rejects_disallowed_requests(
    monkeypatch: pytest.MonkeyPatch, url: str, policy: EgressPolicy
) -> None:
    resolve_to(monkeypatch, {"api.example.com": ["93.184.216.34"]})
    with pytest.raises(EgressBlockedError):
        await send(PinnedTransport(policy, Recorder()), url)


@pytest.mark.anyio
async def test_private_allowlist_and_dev_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve_to(monkeypatch, {"ollama.corp.internal": ["10.0.0.9"]})
    policy = EgressPolicy(allow_private=False, allowed_private_hosts=("ollama.corp.internal",))
    assert (
        await send(PinnedTransport(policy, Recorder()), "https://ollama.corp.internal/")
    ).status_code == 200


@pytest.mark.anyio
async def test_redirects_are_not_followed(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve_to(monkeypatch, {"api.example.com": ["93.184.216.34"]})

    class Redirect(httpx2.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
            return httpx2.Response(302, headers={"location": "http://169.254.169.254/"})

    client = egress.egress_client(EgressPolicy(allow_private=False), 5, Redirect())
    async with client:
        response = await client.get("https://api.example.com/")
    assert response.status_code == 302


# ---------- provider probes ----------


def target(provider: str, **kw: str | None) -> ProviderTarget:
    return ProviderTarget(
        provider,  # type: ignore[arg-type]
        kw.get("secret", "sk-test"),
        kw.get("endpoint"),
        kw.get("api_version"),
        kw.get("deployment"),
    )


async def run_probe(monkeypatch: pytest.MonkeyPatch, t: ProviderTarget, inner: httpx2.AsyncBaseTransport):
    async def public(host: str, port: int) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(egress, "_resolve", public)
    async with egress.egress_client(EgressPolicy(allow_private=False), 5, inner) as client:
        return await probe(client, t)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("t", "body", "expected", "auth_header"),
    [
        (target("openai"), {"data": [{"id": "gpt-b"}, {"id": "gpt-a"}]}, ("gpt-a", "gpt-b"), "authorization"),
        (target("anthropic"), {"data": [{"id": "claude-x"}]}, ("claude-x",), "x-api-key"),
        (
            target("gemini"),
            {
                "models": [
                    {"name": "models/gemini-pro", "supportedGenerationMethods": ["generateContent"]},
                    {"name": "models/embed", "supportedGenerationMethods": ["embedContent"]},
                ]
            },
            ("gemini-pro",),
            "x-goog-api-key",
        ),
        (
            target(
                "azure_openai",
                endpoint="https://r.openai.azure.com/",
                api_version="2024-10-21",
                deployment="gpt4o",
            ),
            {"data": []},
            ("gpt4o",),
            "api-key",
        ),
        (
            target("ollama", secret=None, endpoint="https://ollama.example.com"),
            {"models": [{"name": "llama3"}]},
            ("llama3",),
            None,
        ),
    ],
)
async def test_probe_lists_models(
    monkeypatch: pytest.MonkeyPatch,
    t: ProviderTarget,
    body: Any,
    expected: tuple[str, ...],
    auth_header: str | None,
) -> None:
    inner = Recorder(body=body)
    result = await run_probe(monkeypatch, t, inner)
    assert result.code == "ok"
    assert result.models == expected
    if auth_header:
        assert auth_header in inner.requests[0].headers
    else:
        assert "authorization" not in inner.requests[0].headers


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "unauthorized"),
        (403, "unauthorized"),
        (404, "not_found"),
        (429, "rate_limited"),
        (500, "provider_error"),
    ],
)
async def test_probe_maps_failures_without_leaking_upstream_body(
    monkeypatch: pytest.MonkeyPatch, status: int, code: str
) -> None:
    result = await run_probe(
        monkeypatch, target("openai"), Recorder(status, {"error": "secret internal detail"})
    )
    assert result.code == code
    assert "secret internal detail" not in result.message


@pytest.mark.anyio
async def test_probe_maps_network_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class Down(httpx2.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
            raise httpx2.ConnectError("refused")

    class Slow(httpx2.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
            raise httpx2.ReadTimeout("slow")

    assert (await run_probe(monkeypatch, target("openai"), Down())).code == "unreachable"
    assert (await run_probe(monkeypatch, target("openai"), Slow())).code == "timeout"
    assert (
        await run_probe(monkeypatch, target("openai"), Recorder(body=["not", "an", "object"]))
    ).code == "invalid_response"


# ---------- service auth + route ----------


@pytest.fixture
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def gateway(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> TestClient:
    class Jwks:
        def get_signing_key_from_jwt(self, token: str) -> Any:
            return type("K", (), {"key": signing_key.public_key()})()

    monkeypatch.setattr(service_auth, "_jwks_client", lambda issuer: Jwks())
    router._unwrapper.cache_clear()
    settings = Settings(
        app_env="test",
        local_kek=VECTOR["localKekBase64"],
        service_auth_issuer=ISSUER,
        service_auth_audience=AUDIENCE,
        service_auth_allowed_callers=CALLER,
    )
    return TestClient(create_app(settings))


def token(key: rsa.RSAPrivateKey, **overrides: Any) -> str:
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": AUDIENCE, "sub": CALLER, "iat": now, "exp": now + 300} | overrides
    return jwt.encode(claims, key, algorithm="RS256")


def sealed_body() -> dict[str, Any]:
    keys = (
        "kind",
        "credentialId",
        "envelopeVersion",
        "ciphertext",
        "iv",
        "authTag",
        "wrappedDek",
        "kekId",
        "kekVersion",
        "wrapAlgorithm",
    )
    return {"provider": "openai", "sealed": {k: VECTOR[k] for k in keys}}


def test_internal_route_requires_service_token(gateway: TestClient) -> None:
    assert gateway.post("/internal/v1/providers/probe", json=sealed_body()).status_code == 401


@pytest.mark.parametrize(
    ("overrides", "status"),
    [
        ({"aud": "other"}, 401),
        ({"iss": "https://evil/"}, 401),
        ({"exp": 1}, 401),
        ({"sub": "someone-else"}, 403),
    ],
)
def test_internal_route_rejects_bad_tokens(
    gateway: TestClient, signing_key: rsa.RSAPrivateKey, overrides: dict[str, Any], status: int
) -> None:
    headers = {"authorization": f"Bearer {token(signing_key, **overrides)}"}
    assert (
        gateway.post("/internal/v1/providers/probe", json=sealed_body(), headers=headers).status_code
        == status
    )


def test_rejects_token_signed_by_another_key(gateway: TestClient) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    headers = {"authorization": f"Bearer {token(other)}"}
    assert (
        gateway.post("/internal/v1/providers/probe", json=sealed_body(), headers=headers).status_code == 401
    )


def test_probe_decrypts_sealed_secret_and_never_returns_it(
    gateway: TestClient, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> None:
    inner = Recorder(body={"data": [{"id": "gpt-x"}]})
    real = egress.egress_client
    monkeypatch.setattr(router, "egress_client", lambda policy, timeout: real(policy, timeout, inner))

    async def public(host: str, port: int) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(egress, "_resolve", public)
    response = gateway.post(
        "/internal/v1/providers/probe",
        json=sealed_body(),
        headers={"authorization": f"Bearer {token(signing_key)}"},
    )
    assert response.status_code == 200
    assert response.json()["code"] == "ok"
    assert response.json()["models"] == ["gpt-x"]
    assert inner.requests[0].headers["authorization"] == f"Bearer {VECTOR['expectedSecret']}"
    assert VECTOR["expectedSecret"] not in response.text


def test_tampered_envelope_reports_credential_unavailable(
    gateway: TestClient, signing_key: rsa.RSAPrivateKey
) -> None:
    body = sealed_body()
    body["sealed"]["credentialId"] = "00000000-0000-4000-8000-000000000000"
    response = gateway.post(
        "/internal/v1/providers/probe", json=body, headers={"authorization": f"Bearer {token(signing_key)}"}
    )
    assert response.json()["code"] == "credential_unavailable"


def test_production_settings_require_vault_and_service_auth() -> None:
    with pytest.raises(ValueError, match="azure-key-vault"):
        Settings(app_env="production", local_kek=VECTOR["localKekBase64"])


@pytest.mark.anyio
async def test_tries_next_checked_address_when_first_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve_to(monkeypatch, {"api.example.com": ["2606:4700::1111", "93.184.216.34"]})

    class FirstRefuses(Recorder):
        async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
            if request.url.host == "2606:4700::1111":
                raise httpx2.ConnectError("refused")
            return await super().handle_async_request(request)

    inner = FirstRefuses()
    response = await send(
        PinnedTransport(EgressPolicy(allow_private=False), inner), "https://api.example.com/"
    )
    assert response.status_code == 200
    assert inner.requests[0].url.host == "93.184.216.34"


@pytest.mark.anyio
async def test_gemini_invalid_key_is_unauthorized(monkeypatch: pytest.MonkeyPatch) -> None:
    assert (await run_probe(monkeypatch, target("gemini"), Recorder(400, {}))).code == "unauthorized"
