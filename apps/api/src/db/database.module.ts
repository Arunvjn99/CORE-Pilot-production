import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { createDatabase, createPool } from './database.js';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => createPool(c.DATABASE_URL, c.DATABASE_POOL_MAX),
    },
    { provide: DATABASE, inject: [PG_POOL], useFactory: createDatabase },
  ],
  exports: [PG_POOL, DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
