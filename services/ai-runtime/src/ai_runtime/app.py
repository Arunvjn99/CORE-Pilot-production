"""Application factory."""

from fastapi import FastAPI

from ai_runtime.config import Settings, get_settings
from ai_runtime.correlation import correlation_middleware
from ai_runtime.errors import register_error_handlers
from ai_runtime.gateway.router import router as gateway_router
from ai_runtime.health import router as health_router
from ai_runtime.logging import configure_logging
from ai_runtime.telemetry import configure_tracing


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, service="ai-runtime")
    docs = settings.api_docs_enabled
    app = FastAPI(
        title="CORE AI Design Studio — AI Runtime",
        version=settings.service_version,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.middleware("http")(correlation_middleware)
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(gateway_router)
    app.dependency_overrides[get_settings] = lambda: settings
    configure_tracing(app, settings)
    return app
