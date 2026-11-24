"""Chat completion adapters for the five providers, over the SSRF-safe egress client.

One request/response shape for every agent: system + user messages in, text + token usage out.
Upstream error bodies are never surfaced; failures raise ChatError with a fixed code.
"""

from dataclasses import dataclass
from typing import Any

import httpx2

from ai_runtime.gateway.egress import EgressBlockedError, read_json_capped
from ai_runtime.gateway.providers import ProviderTarget


class ChatError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


ANTHROPIC_TOKEN_HEADROOM = 2


@dataclass(frozen=True, slots=True)
class ChatResult:
    text: str
    input_tokens: int
    output_tokens: int
    model: str


def _base(target: ProviderTarget) -> str:
    if not target.endpoint:
        raise ChatError("endpoint_missing")
    return target.endpoint.rstrip("/")


def _build(
    target: ProviderTarget, model: str, system: str, user: str, max_tokens: int
) -> tuple[str, dict[str, str], dict[str, Any], dict[str, str]]:
    secret = target.secret or ""
    openai_body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": 0.4,
    }
    match target.provider:
        case "openai":
            return (
                "https://api.openai.com/v1/chat/completions",
                {"authorization": f"Bearer {secret}"},
                openai_body,
                {},
            )
        case "azure_openai":
            body = {k: v for k, v in openai_body.items() if k != "model"}
            return (
                f"{_base(target)}/openai/deployments/{target.deployment}/chat/completions",
                {"api-key": secret},
                body,
                {"api-version": target.api_version or ""},
            )
        case "ollama":
            headers = {"authorization": f"Bearer {secret}"} if secret else {}
            return f"{_base(target)}/v1/chat/completions", headers, openai_body, {}
        case "anthropic":
            return (
                "https://api.anthropic.com/v1/messages",
                {"x-api-key": secret, "anthropic-version": "2023-06-01"},
                # No sampling parameters: current Claude models reject temperature/top_p with a 400.
                # Thinking is on by default on current models and shares max_tokens with the answer,
                # so the budget is doubled to leave room for it.
                {
                    "model": model,
                    "system": system,
                    "max_tokens": max_tokens * ANTHROPIC_TOKEN_HEADROOM,
                    "messages": [{"role": "user", "content": user}],
                },
                {},
            )
        case "gemini":
            return (
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                {"x-goog-api-key": secret},
                {
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4},
                },
                {},
            )


def _parse(target: ProviderTarget, payload: Any, model: str) -> ChatResult:
    if not isinstance(payload, dict):
        raise ChatError("invalid_response")
    try:
        match target.provider:
            case "anthropic":
                stop = payload.get("stop_reason")
                if stop == "refusal":
                    raise ChatError("refused")
                if stop == "max_tokens":
                    raise ChatError("truncated")
                text = "".join(b.get("text", "") for b in payload["content"] if b.get("type") == "text")
                usage = payload.get("usage", {})
                return ChatResult(text, int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0)), model)
            case "gemini":
                parts = payload["candidates"][0]["content"]["parts"]
                usage = payload.get("usageMetadata", {})
                return ChatResult(
                    "".join(p.get("text", "") for p in parts),
                    int(usage.get("promptTokenCount", 0)),
                    int(usage.get("candidatesTokenCount", 0)),
                    model,
                )
            case _:
                text = payload["choices"][0]["message"]["content"] or ""
                usage = payload.get("usage") or {}
                return ChatResult(
                    str(text),
                    int(usage.get("prompt_tokens", 0)),
                    int(usage.get("completion_tokens", 0)),
                    model,
                )
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ChatError("invalid_response") from exc


async def chat(
    client: httpx2.AsyncClient,
    target: ProviderTarget,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 8000,
) -> ChatResult:
    url, headers, body, params = _build(target, model, system, user, max_tokens)
    try:
        response = await client.send(
            client.build_request("POST", url, headers=headers, json=body, params=params), stream=True
        )
        try:
            if response.status_code in (401, 403):
                raise ChatError("unauthorized")
            if response.status_code == 429:
                raise ChatError("rate_limited")
            if response.status_code == 404:
                raise ChatError("not_found")
            if response.status_code != 200:
                raise ChatError("provider_error")
            payload = await read_json_capped(response)
        finally:
            await response.aclose()
    except EgressBlockedError as exc:
        raise ChatError("endpoint_blocked") from exc
    except httpx2.TimeoutException as exc:
        raise ChatError("timeout") from exc
    except httpx2.TransportError as exc:
        raise ChatError("unreachable") from exc
    except ValueError as exc:
        raise ChatError("invalid_response") from exc
    return _parse(target, payload, model)
