/** Query parameters that carry one-time or secret values (OAuth callback, future signed links). */
const SENSITIVE_QUERY = new Set([
  'code',
  'state',
  'session_state',
  'id_token',
  'token',
  'access_token',
]);

/** Replaces sensitive query values in a request URL before it is logged. */
export function scrubUrl(url: string | undefined): string | undefined {
  if (!url?.includes('?')) return url;
  const [path, query = ''] = url.split('?', 2);
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()])
    if (SENSITIVE_QUERY.has(key.toLowerCase())) params.set(key, '[REDACTED]');
  return `${path ?? ''}?${params.toString()}`;
}

/** pino-http request serializer wrapper: scrubs url and query on the serialized copy. */
export function scrubRequest<T extends { url?: string; query?: Record<string, unknown> }>(
  req: T,
): T {
  const query = req.query
    ? Object.fromEntries(
        Object.entries(req.query).map(([key, value]) =>
          SENSITIVE_QUERY.has(key.toLowerCase()) ? [key, '[REDACTED]'] : [key, value],
        ),
      )
    : req.query;
  return { ...req, url: scrubUrl(req.url), query };
}
