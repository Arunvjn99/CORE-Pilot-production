"""Correlation-ID middleware; mirrors the contract in @core-studio/contracts."""

import re
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import Request, Response

CORRELATION_ID_HEADER = "x-correlation-id"
_VALID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def resolve_correlation_id(inbound: str | None) -> str:
    return inbound if inbound is not None and _VALID.fullmatch(inbound) else str(uuid.uuid4())


async def correlation_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    correlation_id = resolve_correlation_id(request.headers.get(CORRELATION_ID_HEADER))
    request.state.correlation_id = correlation_id
    with structlog.contextvars.bound_contextvars(correlation_id=correlation_id):
        response = await call_next(request)
    response.headers[CORRELATION_ID_HEADER] = correlation_id
    return response
