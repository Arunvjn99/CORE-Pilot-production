"""POST /internal/v1/agent-test — one agent, one call, same prompt as in a design run."""

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
from ai_runtime.design import router as design_router
from ai_runtime.design.graph import (
    MAX_TOKENS,
    UI_CONTRACT,
    Agent,
    DesignGraph,
    DesignState,
    agent_test_user,
    check_output,
    system_prompt,
)
from ai_runtime.gateway import router as gateway_router
from ai_runtime.gateway.chat import ChatError, ChatResult
from ai_runtime.gateway.providers import ProviderTarget

ROOT = Path(__file__).resolve().parents[3]
VECTOR = json.loads((ROOT / "packages/contracts/test-vectors/credential-envelope-v1.json").read_text())
ISSUER = "https://idp.test/default"
AUDIENCE = "api://core-ai-runtime"
CALLER = "core-api"
SEALED_KEYS = (
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
UI_OUTPUT = "```tsx\nexport default function Main() {\n  return <main>Hi</main>;\n}\n```"


@pytest.fixture
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def runtime(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> TestClient:
    class Jwks:
        def get_signing_key_from_jwt(self, token: str) -> Any:
            return type("K", (), {"key": signing_key.public_key()})()

    monkeypatch.setattr(service_auth, "_jwks_client", lambda issuer: Jwks())
    gateway_router._unwrapper.cache_clear()
    settings = Settings(
        app_env="test",
        local_kek=VECTOR["localKekBase64"],
        service_auth_issuer=ISSUER,
        service_auth_audience=AUDIENCE,
        service_auth_allowed_callers=CALLER,
    )
    return TestClient(create_app(settings))


def headers(key: rsa.RSAPrivateKey) -> dict[str, str]:
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": AUDIENCE, "sub": CALLER, "iat": now, "exp": now + 300}
    return {"authorization": f"Bearer {jwt.encode(claims, key, algorithm='RS256')}"}


def body(**overrides: Any) -> dict[str, Any]:
    return {
        "provider": "ollama",
        "endpoint": "http://127.0.0.1:11434",
        "sealed": {k: VECTOR[k] for k in SEALED_KEYS},
        "agent": "ui",
        "instructions": "You are the UI designer.",
        "model": "llama3.2:3b",
        "prompt": "A sign-in screen",
        "designMd": "# CORE 2.0",
    } | overrides


class FakeChat:
    def __init__(self, text: str = UI_OUTPUT, error: str | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.text = text
        self.error = error

    async def __call__(
        self,
        client: httpx2.AsyncClient,
        target: ProviderTarget,
        model: str,
        system: str,
        user: str,
        max_tokens: int = 8000,
    ) -> ChatResult:
        self.calls.append(
            {"secret": target.secret, "model": model, "system": system, "user": user, "max_tokens": max_tokens}
        )
        if self.error:
            raise ChatError(self.error)
        return ChatResult(self.text, 120, 40, model)


def test_runs_one_agent_with_the_run_prompt_and_reports_usage(
    runtime: TestClient, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeChat()
    monkeypatch.setattr(design_router, "chat", fake)
    response = runtime.post("/internal/v1/agent-test", json=body(), headers=headers(signing_key))
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == "ok"
    assert data["output"] == UI_OUTPUT
    assert data["valid"] is True
    assert data["model"] == "llama3.2:3b"
    assert (data["inputTokens"], data["outputTokens"]) == (120, 40)
    assert data["durationMs"] >= 0
    [call] = fake.calls
    assert call["secret"] == VECTOR["expectedSecret"]  # sealed key opened in the runtime
    assert call["system"] == system_prompt("ui", "You are the UI designer.", "# CORE 2.0")
    assert UI_CONTRACT in call["system"]
    assert call["max_tokens"] == MAX_TOKENS["ui"]
    assert "Screen: Main screen (/)" in call["user"]
    assert VECTOR["expectedSecret"] not in response.text


@pytest.mark.parametrize("agent", ["orchestrator", "ux", "reviewer"])
def test_json_agents_report_whether_output_follows_the_contract(
    runtime: TestClient, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch, agent: str
) -> None:
    monkeypatch.setattr(design_router, "chat", FakeChat(text="not json"))
    data = runtime.post("/internal/v1/agent-test", json=body(agent=agent), headers=headers(signing_key)).json()
    assert data["code"] == "ok"
    assert data["valid"] is False
    monkeypatch.setattr(design_router, "chat", FakeChat(text='{"screens": []}'))
    data = runtime.post("/internal/v1/agent-test", json=body(agent=agent), headers=headers(signing_key)).json()
    assert data["valid"] is True


def test_provider_failures_are_fixed_codes(
    runtime: TestClient, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(design_router, "chat", FakeChat(error="rate_limited"))
    data = runtime.post("/internal/v1/agent-test", json=body(), headers=headers(signing_key)).json()
    assert data == {
        "code": "rate_limited",
        "output": "",
        "valid": False,
        "model": "",
        "inputTokens": 0,
        "outputTokens": 0,
        "durationMs": 0,
    }


def test_unexpected_errors_never_leak_detail(
    runtime: TestClient, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(*args: Any, **kwargs: Any) -> ChatResult:
        raise RuntimeError("secret upstream detail")

    monkeypatch.setattr(design_router, "chat", boom)
    response = runtime.post("/internal/v1/agent-test", json=body(), headers=headers(signing_key))
    assert response.json()["code"] == "internal_error"
    assert "secret upstream detail" not in response.text


def test_tampered_credential_is_reported(
    runtime: TestClient, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeChat()
    monkeypatch.setattr(design_router, "chat", fake)
    tampered = body()
    tampered["sealed"]["credentialId"] = "00000000-0000-4000-8000-000000000000"
    data = runtime.post("/internal/v1/agent-test", json=tampered, headers=headers(signing_key)).json()
    assert data["code"] == "credential_unavailable"
    assert fake.calls == []


def test_requires_service_token_and_valid_input(runtime: TestClient, signing_key: rsa.RSAPrivateKey) -> None:
    assert runtime.post("/internal/v1/agent-test", json=body()).status_code == 401
    bad = runtime.post("/internal/v1/agent-test", json=body(agent="planner"), headers=headers(signing_key))
    assert bad.status_code == 422


# ---------- prompt building shared with the graph ----------


def test_test_messages_match_the_graph_steps() -> None:
    assert agent_test_user("orchestrator", "Loans") == "User request:\nLoans\n\nExisting screens: none"
    assert '"route": "/"' in agent_test_user("ux", "Loans")
    reviewer = agent_test_user("reviewer", "Check contrast\n```tsx\nexport default function A() {}\n```")
    assert reviewer.startswith("User request:\nCheck contrast\n\nScreens:\n## Main screen (/)")
    assert "export default function A() {}" in reviewer
    bare = agent_test_user("reviewer", "export default function B() {}")
    assert "Review this screen." in bare
    assert "export default function B() {}" in bare
    assert agent_test_user("reviewer", "No code") == "User request:\nNo code\n\nScreens:\n"


def test_check_output() -> None:
    assert check_output("ui", UI_OUTPUT)
    assert not check_output("ui", "<div/>")
    assert check_output("reviewer", 'Sure: {"screens": []}')
    assert not check_output("orchestrator", "[1, 2]")


@pytest.mark.anyio
async def test_graph_uses_the_same_system_prompt() -> None:
    systems: list[tuple[str, str]] = []

    async def chat(model: str, system: str, user: str, max_tokens: int) -> ChatResult:
        systems.append((system, user))
        raise ChatError("unauthorized")

    async def emit(event: dict[str, Any]) -> None:
        return None

    agents: dict[str, Agent] = {
        k: {"instructions": f"{k} rules", "model": "m", "enabled": True}
        for k in ("orchestrator", "ux", "ui", "reviewer")
    }
    state: DesignState = {"prompt": "Loans", "design_md": "# DS", "existing": [], "agents": agents}
    with pytest.raises(ChatError):
        await DesignGraph(chat, emit).compile().ainvoke(state)
    assert systems == [
        (system_prompt("orchestrator", "orchestrator rules", "# DS"), agent_test_user("orchestrator", "Loans"))
    ]
