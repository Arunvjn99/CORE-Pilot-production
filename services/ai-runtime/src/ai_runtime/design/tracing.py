"""Optional LangSmith tracing and feedback for design runs.

Off unless LANGSMITH_TRACING=true and LANGSMITH_API_KEY are configured (decision R4: traces contain
prompts and generated designs, so the company must approve the destination first). Tracing never
affects the run: any LangSmith failure is logged and ignored.
"""

import uuid
from typing import Any

import structlog

from ai_runtime.config import Settings

_log = structlog.get_logger()


class Tracer:
    def __init__(self, settings: Settings) -> None:
        self.enabled = bool(settings.langsmith_tracing and settings.langsmith_api_key)
        self._settings = settings
        self._client: Any = None
        if self.enabled:
            from langsmith import Client

            self._client = Client(
                api_key=settings.langsmith_api_key,
                api_url=settings.langsmith_endpoint,
            )

    def config(self, run_id: uuid.UUID, body: Any) -> dict[str, Any]:
        if not self.enabled:
            return {"callbacks": []}
        from langchain_core.tracers.langchain import LangChainTracer

        tracer = LangChainTracer(project_name=self._settings.langsmith_project, client=self._client)
        return {
            "run_id": run_id,
            "run_name": "design-run",
            "callbacks": [tracer],
            "metadata": {"provider": body.provider, "agents": {k: v.model for k, v in body.agents.items()}},
            "tags": ["core-studio", "design-run"],
        }

    def feedback(self, run_id: uuid.UUID, review: dict[str, Any]) -> None:
        if not self.enabled:
            return
        try:
            screens = [s for s in review.get("screens", []) if isinstance(s, dict)]
            if not screens:
                return
            scores = [float(s.get("score", 0)) / 100 for s in screens]
            self._client.create_feedback(run_id, key="design_score", score=sum(scores) / len(scores))
            self._client.create_feedback(
                run_id, key="design_pass_rate", score=sum(1 for s in screens if s.get("pass")) / len(screens)
            )
        except Exception as exc:  # noqa: BLE001 - tracing must never break a run
            _log.warning("langsmith_feedback_failed", exc_type=type(exc).__name__)
