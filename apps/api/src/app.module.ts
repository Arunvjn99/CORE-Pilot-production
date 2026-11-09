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
import { HealthModule } from './health/health.module.js';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage.js';
import { RedisModule } from './redis/redis.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
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
                '*.apiKey',
                '*.password',
                '*.secret',
              ],
              censor: '[REDACTED]',
            },
            autoLogging: { ignore: (req) => req.url?.includes('/health/') ?? false },
          },
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
        HealthModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
