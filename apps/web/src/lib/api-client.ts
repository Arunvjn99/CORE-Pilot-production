import { CORRELATION_ID_HEADER, CSRF_HEADER, errorResponseSchema } from '@core-studio/contracts';
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
 * CSRF token lives only in memory (from GET /auth/session); never in browser storage.
 * Auth itself is the HttpOnly session cookie, sent automatically for same-origin requests.
 */
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type ApiPath = `/api/v1/${string}`;

async function handle<T>(response: Response, schema: z.ZodType<T> | null): Promise<T> {
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
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
  return schema ? schema.parse(body) : (undefined as T);
}

export async function apiGet<T>(
  path: ApiPath,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal: signal ?? null,
  });
  return handle(response, schema);
}

export async function apiSend<T = undefined>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: ApiPath,
  options: { body?: unknown; schema?: z.ZodType<T> } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
  return handle(response, options.schema ?? null);
}
