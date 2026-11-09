import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

export { REDIS } from './redis.tokens.js';
import { REDIS } from './redis.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      // Fail fast at startup if Redis is unreachable; afterwards, never queue commands while disconnected.
      useFactory: async (c: AppConfig) => {
        const client = new Redis(c.REDIS_URL, {
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          lazyConnect: true,
        });
        await client.connect();
        return client;
      },
    },
    RedisThrottlerStorage,
  ],
  exports: [REDIS, RedisThrottlerStorage],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
