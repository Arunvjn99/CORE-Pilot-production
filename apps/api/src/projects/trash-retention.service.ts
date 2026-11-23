import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { organizations, projects } from '../db/schema.js';
import { REDIS } from '../redis/redis.tokens.js';
import { RepositoriesService } from '../repositories/repositories.service.js';

const HOUR = 60 * 60 * 1000;
const LOCK_KEY = 'jobs:trash-retention';
const ACTOR = 'system:trash-retention';
const PER_TEAM_LIMIT = 200;

/**
 * Deletes files that have been in Trash longer than TRASH_RETENTION_DAYS (ADR-0014). Runs hourly on
 * one API replica at a time (Redis lock). Teams are listed in the company-admin context; each team's
 * expired files are then purged inside that team's own RLS context through the same
 * `purge_trashed_project` function as "Delete forever", and audited as the system.
 */
@Injectable()
export class TrashRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrashRetentionService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private first: ReturnType<typeof setTimeout> | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repositories: RepositoriesService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.TRASH_RETENTION_DAYS === 0 || this.config.NODE_ENV === 'test') return;
    const tick = () => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.error({ err: error }, 'Trash retention failed');
      });
    };
    this.first = setTimeout(tick, 60_000);
    this.timer = setInterval(tick, HOUR);
    this.first.unref();
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  /** One pass over every team; returns how many files were deleted. */
  async runOnce(now = new Date()): Promise<number> {
    const days = this.config.TRASH_RETENTION_DAYS;
    if (days === 0) return 0;
    const token = randomUUID();
    if ((await this.redis.set(LOCK_KEY, token, 'EX', 1800, 'NX')) !== 'OK') return 0;
    try {
      const cutoff = new Date(now.getTime() - days * 24 * HOUR);
      const teams = await withDbContext(this.db, { platformAdmin: true }, (tx) =>
        tx.select({ id: organizations.id }).from(organizations),
      );
      let deleted = 0;
      for (const team of teams) deleted += await this.purgeTeam(team.id, cutoff, days);
      if (deleted > 0) this.logger.log({ deleted, days }, 'Trash retention deleted files');
      return deleted;
    } finally {
      // Release only our own lock.
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        LOCK_KEY,
        token,
      );
    }
  }

  private async purgeTeam(organizationId: string, cutoff: Date, days: number): Promise<number> {
    const correlationId = randomUUID();
    const ids = await withDbContext(this.db, { organizationId }, async (tx) => {
      const rows = await tx
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.status, 'archived'), lt(projects.updatedAt, cutoff)))
        .orderBy(asc(projects.id))
        .limit(PER_TEAM_LIMIT)
        .for('update', { skipLocked: true });
      const done: string[] = [];
      for (const file of rows) {
        await this.repositories.lock(tx, file.id);
        const result = await tx.execute<{ result: string }>(
          sql`select purge_trashed_project(${file.id}::uuid) as result`,
        );
        if (result.rows[0]?.result !== 'deleted') continue;
        await this.audit.record(tx, {
          organizationId,
          actorId: ACTOR,
          action: 'project.deleted_permanently',
          targetType: 'project',
          targetId: file.id,
          correlationId,
          metadata: { name: file.name, via: 'retention', retentionDays: days },
        });
        done.push(file.id);
      }
      return done;
    });
    for (const id of ids)
      await this.repositories.removeFiles(organizationId, id).catch((error: unknown) => {
        this.logger.error({ err: error, projectId: id }, 'Removing repository files failed');
      });
    return ids.length;
  }
}
