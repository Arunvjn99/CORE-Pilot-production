"""Design generation graph (LangGraph): plan → UX → UI (per screen, parallel) → review → fix loop.

Agent behaviour comes from team-editable AGENT.md files sent by the API with each run; nothing here
hard-codes a design. The graph only fixes the order of agents and the output contracts the API
validates (JSON plans, one TSX component per screen, JSON review scores).
"""

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

import structlog
from langgraph.graph import END, StateGraph

from ai_runtime.gateway.chat import ChatError, ChatResult

_log = structlog.get_logger()

Emit = Callable[[dict[str, Any]], Awaitable[None]]
ChatFn = Callable[[str, str, str, int], Awaitable[ChatResult]]  # model, system, user, max_tokens

ROUTE = re.compile(r"^/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$")
MAX_SCREENS = 6
FENCE = re.compile(r"```(?:tsx|jsx|typescript|ts)?\s*\n(.*?)```", re.DOTALL)

# Output contracts the API relies on. Kept out of AGENT.md so a team edit can't break parsing.
PLAN_CONTRACT = """Respond with ONLY a JSON object:
{"title": string, "summary": string,
 "screens": [{"name": string, "route": "/lowercase-path", "purpose": string, "links": ["/route", ...]}],
 "todos": [string]}
Use "/" for the first screen. At most 6 screens. Routes: lowercase letters, numbers, hyphens."""

UX_CONTRACT = """Respond with ONLY a JSON object:
{"screens": [{"route": string, "layout": string, "sections": [{"name": string, "content": string}],
 "primaryAction": string, "navigation": [{"label": string, "to": "/route"}]}]}"""

UI_CONTRACT = """Return ONLY one TypeScript React component in a single ```tsx fenced block:
- `export default function <Name>() { ... }`; you may `import { useState } from 'react'` and nothing else.
- Style ONLY with Tailwind CSS utility classes and the design-system CSS variables, e.g.
  `bg-[var(--color-primary)]`, `text-[var(--color-text)]`. No inline <style>, no external URLs, no images from the web.
- To link to another screen, put `data-link="/route"` on the clickable element (no router, no <a href> to other sites).
- Realistic, specific content (no lorem ipsum). Accessible: labels, alt text, contrast, focus states."""

REVIEW_CONTRACT = """Respond with ONLY a JSON object:
{"screens": [{"route": string, "score": 0-100, "pass": boolean,
 "checks": [{"id": string, "pass": boolean, "note": string}], "fixes": [string]}]}
"pass" is true only when the screen follows the design system and every critical check passes."""


class Agent(TypedDict):
    instructions: str
    model: str
    enabled: bool


class DesignState(TypedDict, total=False):
    prompt: str
    design_md: str
    existing: list[dict[str, str]]
    agents: dict[str, Agent]
    max_fix_rounds: int
    plan: dict[str, Any]
    ux: dict[str, Any]
    screens: dict[str, dict[str, str]]  # route -> {name, code}
    review: dict[str, Any]
    fix_round: int


def _json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ChatError("invalid_output")
    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise ChatError("invalid_output") from exc
    if not isinstance(value, dict):
        raise ChatError("invalid_output")
    return value


def _tsx(text: str) -> str:
    match = FENCE.search(text)
    code = (match.group(1) if match else text).strip()
    if "export default" not in code:
        raise ChatError("invalid_output")
    return code + "\n"


CONTRACTS: dict[str, str] = {
    "orchestrator": PLAN_CONTRACT,
    "ux": UX_CONTRACT,
    "ui": UI_CONTRACT,
    "reviewer": REVIEW_CONTRACT,
}
MAX_TOKENS: dict[str, int] = {"orchestrator": 2000, "ux": 4000, "ui": 8000, "reviewer": 3000}


def system_prompt(agent_key: str, instructions: str, design_md: str) -> str:
    """What every agent receives as its system message: AGENT.md, DESIGN.md, then its output contract."""
    return (
        f"{instructions.strip()}\n\n# Design system (DESIGN.md)\n{design_md}"
        f"\n\n# Output contract\n{CONTRACTS[agent_key]}"
    )


def plan_user(prompt: str, existing: list[dict[str, str]]) -> str:
    listed = ", ".join(f"{s['name']} ({s['route']})" for s in existing) or "none"
    return f"User request:\n{prompt}\n\nExisting screens: {listed}"


def ux_user(prompt: str, plan: dict[str, Any]) -> str:
    return f"User request:\n{prompt}\n\nPlan:\n{json.dumps(plan, indent=1)}"


def ui_user(
    prompt: str,
    screen: dict[str, Any],
    others: list[dict[str, str]],
    ux: dict[str, Any],
    previous: str | None = None,
    feedback: str | None = None,
) -> str:
    user = (
        f"User request:\n{prompt}\n\nScreen: {screen['name']} ({screen['route']})\n"
        f"Purpose: {screen.get('purpose', '')}\n"
        f"Links to: {json.dumps(screen.get('links', []))}\nAll screens: {json.dumps(others)}\n"
        f"UX layout:\n{json.dumps(ux, indent=1)}"
    )
    if feedback and previous:
        user += f"\n\nPrevious version:\n```tsx\n{previous}```\nReviewer feedback to fix:\n{feedback}"
    return user


def review_user(prompt: str, screens: dict[str, dict[str, str]]) -> str:
    listing = "\n\n".join(f"## {v['name']} ({k})\n```tsx\n{v['code']}```" for k, v in screens.items())
    return f"User request:\n{prompt}\n\nScreens:\n{listing}"


TEST_SCREEN: dict[str, Any] = {
    "name": "Main screen",
    "route": "/",
    "purpose": "As described in the request",
    "links": [],
}


def agent_test_user(agent_key: str, prompt: str) -> str:
    """User message for a one-agent test run ("Test this agent"), shaped like the real graph step.

    Upstream outputs don't exist in a test, so the agent gets the minimal context it would have
    received: one planned screen for UX and UI. A reviewer test reviews TSX pasted in the request.
    """
    match agent_key:
        case "orchestrator":
            return plan_user(prompt, [])
        case "ux":
            return ux_user(prompt, {"title": "Agent test", "summary": "", "screens": [TEST_SCREEN], "todos": []})
        case "ui":
            return ui_user(prompt, TEST_SCREEN, [{"name": TEST_SCREEN["name"], "route": "/"}], {})
        case _:
            fenced = FENCE.search(prompt)
            if fenced:
                code, request = fenced.group(1), (prompt[: fenced.start()] + prompt[fenced.end() :]).strip()
            elif "export default" in prompt:
                code, request = prompt, ""
            else:
                return review_user(prompt, {})
            screens = {"/": {"name": TEST_SCREEN["name"], "code": code.strip() + "\n"}}
            return review_user(request or "Review this screen.", screens)


def check_output(agent_key: str, text: str) -> bool:
    """Whether the output satisfies the agent's contract the way the graph parses it."""
    try:
        if agent_key == "ui":
            _tsx(text)
        else:
            _json(text)
    except ChatError:
        return False
    return True


class DesignGraph:
    def __init__(self, chat: ChatFn, emit: Emit) -> None:
        self._chat = chat
        self._emit = emit

    async def _call(self, state: DesignState, agent_key: str, label: str, user: str) -> str:
        agent = state["agents"][agent_key]
        started = time.monotonic()
        await self._emit({"type": "step_started", "agent": agent_key, "label": label})
        system = system_prompt(agent_key, agent["instructions"], state["design_md"])
        try:
            result = await self._chat(agent["model"], system, user, MAX_TOKENS[agent_key])
        except ChatError as exc:
            await self._emit({"type": "step_failed", "agent": agent_key, "label": label, "code": exc.code})
            raise
        await self._emit(
            {
                "type": "step_finished",
                "agent": agent_key,
                "label": label,
                "model": result.model,
                "inputTokens": result.input_tokens,
                "outputTokens": result.output_tokens,
                "durationMs": int((time.monotonic() - started) * 1000),
            }
        )
        return result.text

    # ---------- nodes ----------

    async def plan(self, state: DesignState) -> DesignState:
        text = await self._call(
            state, "orchestrator", "Planning screens", plan_user(state["prompt"], state.get("existing", []))
        )
        plan = _json(text)
        screens = [s for s in plan.get("screens", []) if isinstance(s, dict) and ROUTE.match(str(s.get("route", "")))]
        if not screens:
            raise ChatError("invalid_output")
        plan["screens"] = screens[:MAX_SCREENS]
        await self._emit(
            {
                "type": "plan",
                "title": plan.get("title", ""),
                "summary": plan.get("summary", ""),
                "screens": [{"name": s["name"], "route": s["route"]} for s in plan["screens"]],
                "todos": [str(t) for t in plan.get("todos", [])][:10],
            }
        )
        return {"plan": plan, "fix_round": 0, "screens": {}}

    async def ux(self, state: DesignState) -> DesignState:
        if not state["agents"]["ux"]["enabled"]:
            return {"ux": {"screens": []}}
        text = await self._call(state, "ux", "Designing layouts", ux_user(state["prompt"], state["plan"]))
        return {"ux": _json(text)}

    async def _screen(
        self, state: DesignState, screen: dict[str, Any], feedback: str | None
    ) -> tuple[str, dict[str, str]] | None:
        route = screen["route"]
        ux: dict[str, Any] = next((s for s in state["ux"].get("screens", []) if s.get("route") == route), {})
        others = [{"name": s["name"], "route": s["route"]} for s in state["plan"]["screens"]]
        previous = state["screens"].get(route, {}).get("code")
        user = ui_user(state["prompt"], screen, others, ux, previous, feedback)
        try:
            text = await self._call(state, "ui", f"Building {screen['name']}", user)
            code = _tsx(text)
        except ChatError:
            return None
        await self._emit({"type": "screen", "name": screen["name"], "route": route, "code": code})
        return route, {"name": screen["name"], "code": code}

    async def ui(self, state: DesignState) -> DesignState:
        results = await asyncio.gather(*(self._screen(state, s, None) for s in state["plan"]["screens"]))
        built = dict(r for r in results if r is not None)
        if not built:
            raise ChatError("generation_failed")
        return {"screens": built}

    async def review(self, state: DesignState) -> DesignState:
        if not state["agents"]["reviewer"]["enabled"]:
            return {"review": {"screens": []}}
        text = await self._call(
            state, "reviewer", "Reviewing against the design system", review_user(state["prompt"], state["screens"])
        )
        review = _json(text)
        await self._emit({"type": "review", "round": state.get("fix_round", 0), "screens": review.get("screens", [])})
        return {"review": review}

    def _failing(self, state: DesignState) -> list[dict[str, Any]]:
        return [
            r
            for r in state.get("review", {}).get("screens", [])
            if isinstance(r, dict) and not r.get("pass", True) and r.get("route") in state.get("screens", {})
        ]

    def after_review(self, state: DesignState) -> str:
        return "fix" if self._failing(state) and state.get("fix_round", 0) < state.get("max_fix_rounds", 1) else END

    async def fix(self, state: DesignState) -> DesignState:
        by_route = {s["route"]: s for s in state["plan"]["screens"]}
        jobs = [
            self._screen(
                state,
                by_route[r["route"]],
                "\n".join(f"- {f}" for f in r.get("fixes", [])) or "Follow the design system.",
            )
            for r in self._failing(state)
            if r["route"] in by_route
        ]
        results = await asyncio.gather(*jobs)
        screens = dict(state["screens"])
        for r in results:
            if r is not None:
                screens[r[0]] = r[1]
        return {"screens": screens, "fix_round": state.get("fix_round", 0) + 1}

    def compile(self) -> Any:
        graph = StateGraph(DesignState)
        graph.add_node("plan", self.plan)
        graph.add_node("ux", self.ux)
        graph.add_node("ui", self.ui)
        graph.add_node("review", self.review)
        graph.add_node("fix", self.fix)
        graph.set_entry_point("plan")
        graph.add_edge("plan", "ux")
        graph.add_edge("ux", "ui")
        graph.add_edge("ui", "review")
        graph.add_conditional_edges("review", self.after_review, {"fix": "fix", END: END})
        graph.add_edge("fix", "review")
        return graph.compile()
