import { z } from 'zod';

/** Header carrying the request correlation ID across web → api → ai-runtime. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Correlation IDs are accepted from callers only if they match this shape; otherwise a new one is generated. */
export const correlationIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

export const API_VERSION_PREFIX = '/api/v1';

/** Uniform error envelope returned by every service (RFC 9457-inspired). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(512).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
