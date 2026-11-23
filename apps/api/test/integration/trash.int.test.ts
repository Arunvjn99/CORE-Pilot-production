import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { emptyTrashResultSchema, type Project, projectSchema } from '@core-studio/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { auditEvents, generationRuns, runSteps } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp, TEST_BUNDLE_ROOT, TEST_REPO_ROOT } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

/** Delete forever from Trash (team admins and owners only). */
let app: NestExpressApplication;
let pool: pg.Pool;
let adminPool: pg.Pool;
let admin: SignedIn;
let designer: SignedIn;
let teamAdmin: SignedIn;
let owner: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let teamB: string;

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);

async function member(role: 'designer' | 'viewer' | 'org_admin' | 'org_owner', team: string) {
  const who = await signIn(app, newIdentity(`Trash ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

/** A file with history, a run-free repository, a comment and a backup bundle. */
async function richFile(who: SignedIn, name: string): Promise<Project> {
  const file = projectSchema.parse(
    (await mutate(app, 'post', '/api/v1/projects', who).send({ name }).expect(201)).body,
  );
  await mutate(app, 'post', `/api/v1/projects/${file.id}/pages`, who)
    .send({ name: 'Pricing', route: '/pricing' })
    .expect(201);
  await mutate(app, 'post', `/api/v1/projects/${file.id}/checkpoints`, who)
    .send({ message: 'Pricing added' })
    .expect(201);
  await mutate(app, 'post', `/api/v1/projects/${file.id}/comments`, who)
    .send({ body: 'Will be gone' })
    .expect(201);
  return projectSchema.parse((await get(`/api/v1/projects/${file.id}`, who).expect(200)).body);
}

const trash = async (who: SignedIn, file: Project) =>
  projectSchema.parse(
    (
      await mutate(app, 'patch', `/api/v1/projects/${file.id}`, who)
        .send({ status: 'archived', expectedUpdatedAt: file.updatedAt })
        .expect(200)
    ).body,
  );

/** Row counts per table for one file, read with the migration role (outside RLS). */
async function rowsOf(projectId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, column] of [
    ['projects', 'id'],
    ['project_pages', 'project_id'],
    ['project_checkpoints', 'project_id'],
    ['project_repositories', 'project_id'],
    ['generation_runs', 'project_id'],
    ['comments', 'project_id'],
  ] as const) {
    const res = await adminPool.query<{ n: number }>(
      `select count(*)::int as n from ${table} where ${column} = $1`,
      [projectId],
    );
    counts[table] = res.rows[0]?.n ?? -1;
  }
  return counts;
}

const repoDir = (team: string, id: string) => join(TEST_REPO_ROOT, team, id);
const bundleDir = (team: string, id: string) => join(TEST_BUNDLE_ROOT, team, id);

beforeAll(async () => {
  ({ app } = await createTestApp());
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  adminPool = createPool(requireEnv('TEST_ADMIN_DATABASE_URL'), 1);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  const team = async (name: string) =>
    (
      (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
  teamA = await team(`Trash A ${String(Date.now())}`);
  teamB = await team(`Trash B ${String(Date.now())}`);
  designer = await member('designer', teamA);
  teamAdmin = await member('org_admin', teamA);
  owner = await member('org_owner', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
}, 60_000);

afterAll(async () => {
  await pool.end();
  await adminPool.end();
  await app.close();
});

describe('delete forever', () => {
  it('removes a trashed file, its history, rows and repository; the audit trail stays', async () => {
    const file = await trash(designer, await richFile(designer, 'Doomed forever'));
    // A finished design run with a step (normally written by the runs service).
    await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: designer.session.user.id },
      async (tx) => {
        const [run] = await tx
          .insert(generationRuns)
          .values({ organizationId: teamA, projectId: file.id, prompt: 'p', status: 'succeeded' })
          .returning({ id: generationRuns.id });
        await tx.insert(runSteps).values({
          runId: run?.id ?? '',
          organizationId: teamA,
          seq: 1,
          agentKey: 'ux',
          label: 'Plan',
          status: 'succeeded',
        });
      },
    );
    expect(existsSync(repoDir(teamA, file.id))).toBe(true);
    expect(existsSync(bundleDir(teamA, file.id))).toBe(true);
    const before = await rowsOf(file.id);
    expect(before).toMatchObject({ projects: 1, project_pages: 2, project_repositories: 1 });
    expect(before.project_checkpoints).toBeGreaterThanOrEqual(2);
    expect(before.comments).toBe(1);
    expect(before.generation_runs).toBe(1);
    const stepsBefore = await adminPool.query<{ n: number }>(
      'select count(*)::int as n from run_steps s join generation_runs r on r.id = s.run_id where r.project_id = $1',
      [file.id],
    );
    expect(stepsBefore.rows[0]?.n).toBe(1);
    // Only this file has runs in team A.
    const teamSteps = async () =>
      (
        await adminPool.query<{ n: number }>(
          'select count(*)::int as n from run_steps where organization_id = $1',
          [teamA],
        )
      ).rows[0]?.n;

    await mutate(app, 'delete', `/api/v1/projects/${file.id}`, teamAdmin).expect(204);

    expect(await rowsOf(file.id)).toEqual({
      projects: 0,
      project_pages: 0,
      project_checkpoints: 0,
      project_repositories: 0,
      generation_runs: 0,
      comments: 0,
    });
    expect(await teamSteps()).toBe(0);
    expect(existsSync(repoDir(teamA, file.id))).toBe(false);
    expect(existsSync(bundleDir(teamA, file.id))).toBe(false);
    await get(`/api/v1/projects/${file.id}`, designer).expect(404);
    await mutate(app, 'delete', `/api/v1/projects/${file.id}`, teamAdmin).expect(404);

    const audit = await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: teamAdmin.session.user.id },
      (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.targetType, 'project'), eq(auditEvents.targetId, file.id))),
    );
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('project.created');
    expect(actions).toContain('project.archived');
    const deleted = audit.find((a) => a.action === 'project.deleted_permanently');
    expect(deleted).toMatchObject({
      actorId: teamAdmin.session.user.id,
      metadata: { name: 'Doomed forever', via: 'file' },
    });
  });

  it('only works from Trash', async () => {
    const file = await richFile(designer, 'Still active');
    const res = await mutate(app, 'delete', `/api/v1/projects/${file.id}`, owner).expect(409);
    expect(res.body).toMatchObject({ error: { code: 'NOT_IN_TRASH' } });
    expect((await rowsOf(file.id)).projects).toBe(1);
    expect(existsSync(repoDir(teamA, file.id))).toBe(true);
  });

  it('is for team admins and owners only, and never across teams', async () => {
    const file = await trash(designer, await richFile(designer, 'Guarded trash'));
    await mutate(app, 'delete', `/api/v1/projects/${file.id}`, designer).expect(403);
    await mutate(app, 'delete', `/api/v1/projects/${file.id}`, viewer).expect(403);
    await mutate(app, 'delete', `/api/v1/projects/${file.id}`, outsider).expect(404);
    await mutate(app, 'delete', '/api/v1/projects/trash', designer).expect(403);
    expect((await rowsOf(file.id)).projects).toBe(1);

    // The database function itself refuses files outside the transaction's team.
    const db = createDatabase(pool);
    const outcome = await withDbContext(
      db,
      { organizationId: teamB, userId: outsider.session.user.id },
      async (tx) =>
        (
          await tx.execute<{ result: string }>(
            sql`select purge_trashed_project(${file.id}::uuid) as result`,
          )
        ).rows[0]?.result,
    );
    expect(outcome).toBe('not_found');
    expect((await rowsOf(file.id)).projects).toBe(1);
    // Without a team context it refuses outright.
    await expect(
      withDbContext(db, { userId: outsider.session.user.id }, (tx) =>
        tx.execute(sql`select purge_trashed_project(${file.id}::uuid)`),
      ),
    ).rejects.toThrow();

    await mutate(app, 'delete', `/api/v1/projects/${file.id}`, owner).expect(204);
    expect((await rowsOf(file.id)).projects).toBe(0);
  });

  it('cannot be bypassed: the app role still cannot delete checkpoints directly', async () => {
    const file = await richFile(designer, 'Append-only history');
    const res = await pool
      .query('delete from project_checkpoints where project_id = $1', [file.id])
      .then(
        () => 'deleted',
        (error: unknown) => (error as { code?: string }).code,
      );
    expect(res).toBe('42501');
  });

  it('empties the whole Trash of the team only', async () => {
    const one = await trash(designer, await richFile(designer, 'Trash one'));
    const two = await trash(designer, await richFile(designer, 'Trash two'));
    const keep = await richFile(designer, 'Not trashed');
    const theirs = await trash(outsider, await richFile(outsider, 'Their trash'));

    const res = emptyTrashResultSchema.parse(
      (await mutate(app, 'delete', '/api/v1/projects/trash', owner).expect(200)).body,
    );
    expect(res.deleted).toBeGreaterThanOrEqual(2);
    for (const file of [one, two]) {
      expect((await rowsOf(file.id)).projects).toBe(0);
      expect(existsSync(repoDir(teamA, file.id))).toBe(false);
    }
    expect((await rowsOf(keep.id)).projects).toBe(1);
    expect((await rowsOf(theirs.id)).projects).toBe(1);
    expect(existsSync(repoDir(teamB, theirs.id))).toBe(true);
    const archived = z
      .array(projectSchema)
      .parse((await get('/api/v1/projects?status=archived', viewer).expect(200)).body);
    expect(archived).toEqual([]);
    expect(
      emptyTrashResultSchema.parse(
        (await mutate(app, 'delete', '/api/v1/projects/trash', teamAdmin).expect(200)).body,
      ),
    ).toEqual({ deleted: 0 });
  });
});
