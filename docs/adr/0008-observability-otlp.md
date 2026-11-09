# ADR-0008: Observability — vendor-neutral OTLP export

Status: **Accepted (Phase 1, implementation decision — review requested)**

## Context

Requirement: Azure Monitor + Application Insights, with images that ship unchanged between local and Azure. `@azure/monitor-opentelemetry` pulled duplicate and deprecated OpenTelemetry SDK versions and conflicting `@opentelemetry/api` peer ranges.

## Decision

Services emit traces via OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`) using the OpenTelemetry SDKs with explicit instrumentations. In Azure Container Apps, the managed OpenTelemetry agent forwards OTLP to Application Insights. Locally, any OTLP collector can be used; export is disabled when the endpoint is unset.

## Trade-offs

- One image for all environments, fewer dependencies, vendor-neutral. − Relies on the ACA managed OTel agent (or a collector sidecar) being configured in infrastructure (Phase 7 Bicep).

## Risks

App Insights–specific features (live metrics) are not available via OTLP forwarding; revisit if needed.
