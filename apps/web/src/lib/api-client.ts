import { CORRELATION_ID_HEADER, errorResponseSchema } from '@core-studio/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Same-origin fetch with cookie credentials (BFF session from Phase 2) and response validation.
 * Never attaches bearer tokens; nothing auth-related is kept in browser storage.
 */
export async function apiGet<T>(
  path: `/api/v1/${string}`,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal: signal ?? null,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'UNKNOWN_ERROR',
      parsed.success
        ? parsed.data.error.message
        : `Request failed with status ${String(response.status)}`,
      response.headers.get(CORRELATION_ID_HEADER),
    );
  }
  return schema.parse(body);
}
