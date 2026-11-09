import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * Loaded with `node --import` before the app. Exports OTLP only when OTEL_EXPORTER_OTLP_ENDPOINT
 * is set (local collector, or the Azure Container Apps managed OTel agent → Application Insights).
 */
if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) {
  const sdk = new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'core-studio-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url?.includes('/health/') ?? false,
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation({ dbStatementSerializer: (cmd) => cmd }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => void sdk.shutdown());
}
