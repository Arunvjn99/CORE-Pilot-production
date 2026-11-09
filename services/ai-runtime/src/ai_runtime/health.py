"""Liveness/readiness. Phase 1 has no downstream dependencies; checks are added with them."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded", "error"]
    service: str
    version: str
    checks: dict[str, Literal["up", "down"]]


@router.get("/live")
async def live(request: Request) -> HealthResponse:
    return HealthResponse(status="ok", service="ai-runtime", version=request.app.version, checks={})


@router.get("/ready")
async def ready(request: Request) -> HealthResponse:
    return HealthResponse(status="ok", service="ai-runtime", version=request.app.version, checks={})
