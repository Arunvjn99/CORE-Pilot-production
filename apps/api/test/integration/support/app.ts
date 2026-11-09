import { Controller, Get, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import { configureApp } from '../../../src/app.setup.js';
import { RequireRecentAuth } from '../../../src/auth/decorators.js';
import { type AppConfig, loadConfig } from '../../../src/config/env.js';
import { REDIS } from '../../../src/redis/redis.tokens.js';
import { requireEnv } from '../env.js';

export const APP_ORIGIN = 'http://studio.test';
export const TENANT_ID = '7d0c3a2e-0f4e-4b8a-9a35-1f6a2b3c4d5e';
export const ADMIN_OID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Test-only route used to exercise the step-up guard. */
@Controller({ path: 'test-sensitive', version: '1' })
class SensitiveProbeController {
  @Get()
  @RequireRecentAuth()
  get() {
    return { ok: true };
  }
}

export async function createTestApp(
  overrides: Record<string, string> = {},
  extraControllers: Type[] = [SensitiveProbeController],
): Promise<{ app: NestExpressApplication; config: AppConfig }> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: requireEnv('TEST_DATABASE_URL'),
    REDIS_URL: requireEnv('TEST_REDIS_URL'),
    CORS_ALLOWED_ORIGINS: 'http://allowed.test',
    AI_RUNTIME_URL: 'http://localhost:8000',
    RATE_LIMIT_PER_MINUTE: '10000',
    PUBLIC_APP_ORIGIN: APP_ORIGIN,
    OIDC_ISSUER_URL: requireEnv('TEST_OIDC_ISSUER_URL'),
    OIDC_CLIENT_ID: 'core-studio-test',
    OIDC_CLIENT_SECRET: 'test-client-secret-0123456789',
    OIDC_ALLOWED_TENANT_ID: TENANT_ID,
    BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS: ADMIN_OID,
    ...overrides,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: extraControllers,
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  await app.get<{ flushdb: () => Promise<unknown> }>(REDIS).flushdb();
  return { app, config };
}
