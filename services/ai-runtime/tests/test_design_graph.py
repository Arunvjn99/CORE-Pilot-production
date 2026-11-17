import json
from typing import Any

import pytest

from ai_runtime.design.graph import DesignGraph, DesignState
from ai_runtime.gateway.chat import ChatError, ChatResult

SCREEN = '```tsx\nexport default function {name}() {{\n  return <main data-link="/next">{name}</main>;\n}}\n```'


def scripted(fail_first_review: bool = True):
    calls: list[str] = []
    reviews = {"n": 0}

    async def chat(model: str, system: str, user: str, max_tokens: int) -> ChatResult:
        role = system.split("\n", 1)[0]
        calls.append(role)
        if role == "PLANNER":
            body = {
                "title": "Loan app",
                "summary": "s",
                "todos": ["a"],
                "screens": [
                    {"name": "Home", "route": "/", "purpose": "p", "links": ["/apply"]},
                    {"name": "Apply", "route": "/apply", "purpose": "p", "links": []},
                    {"name": "Bad", "route": "/Not Valid", "purpose": "x", "links": []},
                ],
            }
            return ChatResult(json.dumps(body), 10, 20, model)
        if role == "UX":
            return ChatResult(json.dumps({"screens": [{"route": "/", "layout": "stack"}]}), 5, 5, model)
        if role == "UI":
            name = "Home" if "Screen: Home" in user else "Apply"
            return ChatResult(SCREEN.format(name=name + "Page"), 3, 30, model)
        reviews["n"] += 1
        failing = fail_first_review and reviews["n"] == 1
        return ChatResult(
            json.dumps(
                {
                    "screens": [
                        {
                            "route": "/",
                            "score": 60 if failing else 90,
                            "pass": not failing,
                            "checks": [],
                            "fixes": ["use tokens"],
                        },
                        {"route": "/apply", "score": 88, "pass": True, "checks": [], "fixes": []},
                    ]
                }
            ),
            7,
            7,
            model,
        )

    return chat, calls


def state() -> DesignState:
    agents = {
        k: {"instructions": k.upper() if k != "orchestrator" else "PLANNER", "model": "m", "enabled": True}
        for k in ("orchestrator", "ux", "ui", "reviewer")
    }
    agents["reviewer"]["instructions"] = "REVIEWER"
    return {"prompt": "loan app", "design_md": "# DS", "existing": [], "agents": agents, "max_fix_rounds": 1}


@pytest.mark.anyio
async def test_graph_runs_plan_ux_ui_review_and_fixes_failures() -> None:
    chat, calls = scripted()
    events: list[dict[str, Any]] = []

    async def emit(event: dict[str, Any]) -> None:
        events.append(event)

    final = await DesignGraph(chat, emit).compile().ainvoke(state())
    assert set(final["screens"]) == {"/", "/apply"}  # invalid route from the plan was dropped
    assert final["fix_round"] == 1
    assert calls.count("UI") == 3  # two screens + one fix for the failing screen
    assert calls.count("REVIEWER") == 2
    types = [e["type"] for e in events]
    assert types[0] == "step_started"
    assert "plan" in types
    assert types.count("review") == 2
    finished = [e for e in events if e["type"] == "step_finished"]
    assert all(e["inputTokens"] >= 0 and e["durationMs"] >= 0 for e in finished)


@pytest.mark.anyio
async def test_disabled_reviewer_skips_review() -> None:
    chat, calls = scripted()
    s = state()
    s["agents"]["reviewer"]["enabled"] = False

    async def emit(event: dict[str, Any]) -> None:
        return None

    final = await DesignGraph(chat, emit).compile().ainvoke(s)
    assert "REVIEWER" not in calls
    assert len(final["screens"]) == 2


@pytest.mark.anyio
async def test_unparseable_plan_fails_the_run() -> None:
    async def chat(model: str, system: str, user: str, max_tokens: int) -> ChatResult:
        return ChatResult("no json here", 1, 1, model)

    async def emit(event: dict[str, Any]) -> None:
        return None

    with pytest.raises(ChatError):
        await DesignGraph(chat, emit).compile().ainvoke(state())
