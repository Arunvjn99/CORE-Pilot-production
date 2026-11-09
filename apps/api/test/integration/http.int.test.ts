import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ErrorResponse, errorResponseSchema } from '@core-studio/contracts';
import { Public } from '../../src/auth/decorators.js';
import { createTestApp } from './support/app.js';

const RATE_LIMIT = 5;

/** Test-only route: the throttler guard applies to matched handlers. */
@Public()
@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}
let app: NestExpressApplication;

beforeAll(async () => {
  ({ app } = await createTestApp({ RATE_LIMIT_PER_MINUTE: String(RATE_LIMIT) }, [ProbeController]));
});

afterAll(async () => {
  await app.close();
});

describe('API HTTP foundation', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('reports readiness with real Postgres and Redis', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect((res.body as { info: unknown }).info).toEqual({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only configured CORS origins', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://allowed.test');
    expect(ok.headers['access-control-allow-origin']).toBe('http://allowed.test');
    const denied = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://evil.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('propagates safe correlation ids and replaces unsafe ones', async () => {
    const kept = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'trace-12345678');
    expect(kept.headers['x-correlation-id']).toBe('trace-12345678');
    const replaced = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'x');
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects unauthenticated access to unknown routes with the shared envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(errorResponseSchema.parse(res.body).error).toMatchObject({
      code: 'NOT_FOUND',
      correlationId: res.headers['x-correlation-id'],
    });
  });

  it('rate-limits non-health routes using shared Redis state', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT + 2; i++) {
      statuses.push((await request(app.getHttpServer()).get('/api/v1/probe')).status);
    }
    expect(statuses.slice(0, RATE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const limited = await request(app.getHttpServer()).get('/api/v1/probe').expect(429);
    expect((limited.body as ErrorResponse).error.code).toBe('RATE_LIMITED');
  });
});
