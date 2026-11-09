"""OpenTelemetry tracing. Exports OTLP only when an endpoint is configured."""

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from ai_runtime.config import Settings


def configure_tracing(app: FastAPI, settings: Settings) -> None:
    if not settings.otel_exporter_otlp_endpoint:
        return
    provider = TracerProvider(
        resource=Resource.create(
            {"service.name": "core-studio-ai-runtime", "service.version": settings.service_version}
        )
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health/live,health/ready")
