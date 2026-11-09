import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CORRELATION_ID_HEADER, correlationIdSchema } from '@core-studio/contracts';

/** Accept a well-formed inbound correlation ID; otherwise mint one. Prevents log injection via the header. */
export function resolveCorrelationId(req: IncomingMessage): string {
  const inbound = req.headers[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  return correlationIdSchema.safeParse(candidate).success && candidate ? candidate : randomUUID();
}
