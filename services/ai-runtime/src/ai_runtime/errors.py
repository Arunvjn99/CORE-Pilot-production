"""Uniform error envelope (same shape as the API's ErrorResponse)."""

from http import HTTPStatus

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_log = structlog.get_logger()


def _envelope(request: Request, status: int, code: str, message: str) -> JSONResponse:
    correlation_id = getattr(request.state, "correlation_id", "unknown")
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "correlationId": correlation_id}},
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _envelope(request, exc.status_code, HTTPStatus(exc.status_code).name, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, _: RequestValidationError) -> JSONResponse:
        return _envelope(request, 422, "VALIDATION_ERROR", "Request validation failed")

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        _log.exception("unhandled_error", exc_type=type(exc).__name__)
        return _envelope(request, 500, "INTERNAL_SERVER_ERROR", "Internal server error")
