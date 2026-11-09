import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { resolveCorrelationId } from './common/correlation-id.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { CORRELATION_ID_HEADER } from '@core-studio/contracts';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { DatabaseModule } from './db/database.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CredentialsModule } from './credentials/credentials.module.js';
import { HealthModule } from './health/health.module.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage.js';
import { RedisModule } from './redis/redis.module.js';

@Module({})
export class AppModule {
  /** `logStream` lets tests capture structured logs to prove redaction; production logs go to stdout. */
  static forRoot(
    config: AppConfig,
    options: { logStream?: NodeJS.WritableStream } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: [
            {
              level: config.LOG_LEVEL,
              genReqId: (req, res) => {
                const id = resolveCorrelationId(req);
                res.setHeader(CORRELATION_ID_HEADER, id);
                return id;
              },
              customProps: () => ({ service: 'api' }),
              // Defence in depth: never log credentials even if a future route receives them.
              redact: {
                paths: [
                  'req.headers.authorization',
                  'req.headers.cookie',
                  'res.headers["set-cookie"]',
                  'req.headers["x-csrf-token"]',
                  '*.apiKey',
                  '*.password',
                  '*.secret',
                  '*.*.secret',
                ],
                censor: '[REDACTED]',
              },
              autoLogging: { ignore: (req) => req.url?.includes('/health/') ?? false },
            },
            options.logStream ?? process.stdout,
          ],
        }),
        DatabaseModule,
        RedisModule,
        ThrottlerModule.forRootAsync({
          inject: [RedisThrottlerStorage],
          useFactory: (storage: RedisThrottlerStorage) => ({
            throttlers: [{ ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }],
            storage,
          }),
        }),
        AuditModule,
        HealthModule,
        AuthModule,
        OrgsModule,
        CredentialsModule,
        ProjectsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
