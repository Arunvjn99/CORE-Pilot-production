"""POST /internal/v1/design-runs — runs the design graph and streams NDJSON events to the API.
POST /internal/v1/agent-test — runs ONE agent once ("Test this agent" in Settings → Agents).

The API sends the team's sealed credential (one key for every agent), the AGENT.md set, the
project's DESIGN.md and the prompt. The runtime never writes project files: generated screens are
returned as events and the API validates and commits them through its repository pipeline.
"""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal

import structlog
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import Field

from ai_runtime.config import Settings, get_settings
from ai_runtime.design.graph import (
    MAX_TOKENS,
    Agent,
    DesignGraph,
    DesignState,
    agent_test_user,
    check_output,
    system_prompt,
)
from ai_runtime.design.tracing import Tracer
from ai_runtime.gateway.chat import ChatError, ChatResult, chat
from ai_runtime.gateway.egress import EgressPolicy, egress_client
from ai_runtime.gateway.providers import Provider, ProviderTarget
from ai_runtime.gateway.router import SealedPayload, _Camel, _sealed, _unwrapper
from ai_runtime.service_auth import require_service_caller
from ai_runtime.vault.envelope import CredentialDecryptionError, open_sealed

_log = structlog.get_logger()

AGENT_KEYS = ("orchestrator", "ux", "ui", "reviewer")
# DESIGN.md (200k) + tokens.css (50k) + team knowledge (60k) as composed by the API, with headroom.
DESIGN_CONTEXT_MAX = 320_000


class AgentConfig(_Camel):
    instructions: str = Field(min_length=1, max_length=40_000)
    model: str = Field(min_length=1, max_length=200)
    enabled: bool = True


class ExistingScreen(_Camel):
    name: str = Field(max_length=80)
    route: str = Field(max_length=120)


class _TargetRequest(_Camel):
    provider: Provider
    endpoint: str | None = Field(default=None, max_length=500)
    api_version: str | None = Field(default=None, max_length=50)
    deployment: str | None = Field(default=None, max_length=200)
    sealed: SealedPayload | None = None


class DesignRunRequest(_TargetRequest):
    run_id: str = Field(min_length=36, max_length=36)
    prompt: str = Field(min_length=1, max_length=8000)
    design_md: str = Field(max_length=DESIGN_CONTEXT_MAX)
    existing: list[ExistingScreen] = Field(default_factory=list, max_length=50)
    agents: dict[str, AgentConfig]
    max_fix_rounds: int = Field(default=1, ge=0, le=3)


class AgentTestRequest(_TargetRequest):
    agent: Literal["orchestrator", "ux", "ui", "reviewer"]
    instructions: str = Field(min_length=1, max_length=40_000)
    model: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=8000)
    design_md: str = Field(max_length=DESIGN_CONTEXT_MAX)


class AgentTestResponse(_Camel):
    """`code` is "ok" or a fixed error code; upstream detail is never included."""

    code: str
    output: str = ""
    valid: bool = False
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0


router = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_service_caller)])


def _open_target(body: _TargetRequest, settings: Settings) -> ProviderTarget:
    """Decrypts the sealed key (raises ChatError("credential_unavailable")) into a provider target."""
    secret: str | None = None
    if body.sealed is not None:
        try:
            secret = open_sealed(_sealed(body.sealed), _unwrapper(settings))
        except (CredentialDecryptionError, ValueError) as exc:
            raise ChatError("credential_unavailable") from exc
    return ProviderTarget(body.provider, secret, body.endpoint, body.api_version, body.deployment)


def _policy(settings: Settings) -> EgressPolicy:
    return EgressPolicy(
        allow_private=settings.app_env != "production",
        allowed_private_hosts=settings.allowed_private_hosts,
        require_https=settings.app_env == "production",
    )


def _line(event: dict[str, Any]) -> bytes:
    return (json.dumps(event, separators=(",", ":")) + "\n").encode()


@router.post("/design-runs")
async def design_run(body: DesignRunRequest, settings: Annotated[Settings, Depends(get_settings)]) -> StreamingResponse:
    missing = [k for k in AGENT_KEYS if k not in body.agents]
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    async def run() -> None:
        try:
            if missing:
                await emit({"type": "error", "code": "agents_missing"})
                return
            target = _open_target(body, settings)
            async with egress_client(_policy(settings), settings.design_timeout_seconds) as client:

                async def call(model: str, system: str, user: str, max_tokens: int) -> ChatResult:
                    return await chat(client, target, model, system, user, max_tokens)

                graph = DesignGraph(call, emit).compile()
                agents: dict[str, Agent] = {
                    k: {"instructions": v.instructions, "model": v.model, "enabled": v.enabled}
                    for k, v in body.agents.items()
                }
                state: DesignState = {
                    "prompt": body.prompt,
                    "design_md": body.design_md,
                    "existing": [{"name": e.name, "route": e.route} for e in body.existing],
                    "agents": agents,
                    "max_fix_rounds": body.max_fix_rounds,
                }
                tracer = Tracer(settings)
                trace_id = uuid.UUID(body.run_id)
                final: DesignState = await graph.ainvoke(state, config=tracer.config(trace_id, body))
                tracer.feedback(trace_id, final.get("review", {}))
            await emit(
                {
                    "type": "done",
                    "title": final.get("plan", {}).get("title", ""),
                    "screens": [
                        {"route": r, "name": s["name"], "code": s["code"]} for r, s in final.get("screens", {}).items()
                    ],
                    "review": final.get("review", {}).get("screens", []),
                    "traced": tracer.enabled,
                }
            )
        except ChatError as exc:
            await emit({"type": "error", "code": exc.code})
        except Exception as exc:  # noqa: BLE001 - reported as a fixed code, details only in logs
            _log.exception("design_run_failed", exc_type=type(exc).__name__)
            await emit({"type": "error", "code": "internal_error"})
        finally:
            await queue.put(None)

    async def stream() -> AsyncIterator[bytes]:
        task = asyncio.create_task(run())
        try:
            while (event := await queue.get()) is not None:
                yield _line(event)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.post("/agent-test", response_model=AgentTestResponse, response_model_by_alias=True)
async def agent_test(body: AgentTestRequest, settings: Annotated[Settings, Depends(get_settings)]) -> AgentTestResponse:
    """One chat call with the agent's system prompt and output contract, built exactly as in a run."""
    started = time.monotonic()
    try:
        target = _open_target(body, settings)
        async with egress_client(_policy(settings), settings.design_timeout_seconds) as client:
            result = await chat(
                client,
                target,
                body.model,
                system_prompt(body.agent, body.instructions, body.design_md),
                agent_test_user(body.agent, body.prompt),
                MAX_TOKENS[body.agent],
            )
        del target
    except ChatError as exc:
        _log.info("agent_test_failed", agent=body.agent, code=exc.code)
        return AgentTestResponse(code=exc.code)
    except Exception as exc:  # noqa: BLE001 - reported as a fixed code, details only in logs
        _log.exception("agent_test_crashed", exc_type=type(exc).__name__)
        return AgentTestResponse(code="internal_error")
    duration = int((time.monotonic() - started) * 1000)
    _log.info("agent_test", agent=body.agent, duration_ms=duration)
    return AgentTestResponse(
        code="ok",
        output=result.text,
        valid=check_output(body.agent, result.text),
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        duration_ms=duration,
    )
