import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type Project, projectSchema } from '@core-studio/contracts';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { auditEvents } from '../../src/db/schema.js';
import { TrashRetentionService } from '../../src/projects/trash-retention.service.js';
import { REDIS } from '../../src/redis/redis.tokens.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp, TEST_REPO_ROOT } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

let app: NestExpressApplication;
let adminPool: pg.Pool;
let appPool: pg.Pool;
let admin: SignedIn;
let teamA: string;
let teamB: string;
let ownerA: SignedIn;
let ownerB: SignedIn;

const DAY = 24 * 60 * 60 * 1000;

async function member(team: string) {
  const who = await signIn(app, newIdentity('Retention owner'));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role: 'org_owner' })
    .expect(204);
  return refreshSession(app, who);
}

async function file(who: SignedIn, name: string, trashedDaysAgo: number | null): Promise<Project> {
  let f = projectSchema.parse(
    (await mutate(app, 'post', '/api/v1/projects', who).send({ name }).expect(201)).body,
  );
  if (trashedDaysAgo !== null) {
    f = projectSchema.parse(
      (
        await mutate(app, 'patch', `/api/v1/projects/${f.id}`, who)
          .send({ status: 'archived', expectedUpdatedAt: f.updatedAt })
          .expect(200)
      ).body,
    );
    // Age the trashed file (the migration role bypasses nothing it shouldn't: test-only update).
    await adminPool.query('update projects set updated_at = $1 where id = $2', [
      new Date(Date.now() - trashedDaysAgo * DAY),
      f.id,
    ]);
  }
  return f;
}

const exists = async (team: string, id: string) =>
  (
    await adminPool.query('select 1 from projects where id = $1 and organization_id = $2', [
      id,
      team,
    ])
  ).rowCount === 1;

beforeAll(async () => {
  ({ app } = await createTestApp({ TRASH_RETENTION_DAYS: '30' }));
  adminPool = createPool(requireEnv('TEST_ADMIN_DATABASE_URL'), 1);
  appPool = createPool(requireEnv('TEST_DATABASE_URL'), 1);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  const team = async (name: string) =>
    (
      (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
  teamA = await team(`Retention A ${String(Date.now())}`);
  teamB = await team(`Retention B ${String(Date.now())}`);
  ownerA = await member(teamA);
  ownerB = await member(teamB);
}, 60_000);

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
  await app.close();
});

describe('Trash retention job', () => {
  it('deletes only files in Trash longer than the retention period, in every team', async () => {
    const oldA = await file(ownerA, 'Old trash A', 45);
    const recentA = await file(ownerA, 'Recent trash A', 5);
    const activeA = await file(ownerA, 'Active A', null);
    await adminPool.query('update projects set updated_at = $1 where id = $2', [
      new Date(Date.now() - 400 * DAY),
      activeA.id,
    ]);
    const oldB = await file(ownerB, 'Old trash B', 31);
    const repoDir = join(TEST_REPO_ROOT, teamA, oldA.id);
    expect(existsSync(repoDir)).toBe(true);

    const deleted = await app.get(TrashRetentionService).runOnce();
    expect(deleted).toBeGreaterThanOrEqual(2);

    expect(await exists(teamA, oldA.id)).toBe(false);
    expect(await exists(teamB, oldB.id)).toBe(false);
    expect(await exists(teamA, recentA.id)).toBe(true);
    expect(await exists(teamA, activeA.id)).toBe(true);
    expect(existsSync(repoDir)).toBe(false);

    const audits = await withDbContext(createDatabase(appPool), { organizationId: teamA }, (tx) =>
      tx
        .select({ actorId: auditEvents.actorId, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetId, oldA.id),
            eq(auditEvents.action, 'project.deleted_permanently'),
          ),
        ),
    );
    expect(audits).toEqual([
      {
        actorId: 'system:trash-retention',
        metadata: { name: 'Old trash A', via: 'retention', retentionDays: 30 },
      },
    ]);
  });

  it('runs on one replica at a time', async () => {
    const old = await file(ownerA, 'Locked out', 60);
    const redis = app.get<{
      set: (...args: unknown[]) => Promise<unknown>;
      del: (k: string) => Promise<unknown>;
    }>(REDIS);
    await redis.set('jobs:trash-retention', 'another-replica', 'EX', 60);
    expect(await app.get(TrashRetentionService).runOnce()).toBe(0);
    expect(await exists(teamA, old.id)).toBe(true);
    await redis.del('jobs:trash-retention');
    await app.get(TrashRetentionService).runOnce();
    expect(await exists(teamA, old.id)).toBe(false);
  });
});
