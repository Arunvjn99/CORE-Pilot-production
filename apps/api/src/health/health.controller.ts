import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { PG_POOL } from '../db/database.module.js';
import { REDIS } from '../redis/redis.module.js';

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('live')
  live() {
    return { status: 'ok', service: 'api', version: this.config.SERVICE_VERSION, checks: {} };
  }

  /** Readiness: dependencies reachable. Exposes up/down only, never connection details. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.check('database', () => this.pool.query('select 1')),
      () => this.check('redis', () => this.redis.ping()),
    ]);
  }

  private async check(key: string, probe: () => Promise<unknown>): Promise<HealthIndicatorResult> {
    const session = this.indicator.check(key);
    try {
      await probe();
      return session.up();
    } catch {
      return session.down();
    }
  }
}
