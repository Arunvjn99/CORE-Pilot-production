import type { NestExpressApplication } from '@nestjs/platform-express';
import { type Project, pageSchema, projectSchema } from '@core-studio/contracts';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withTenant } from '../../src/db/database.js';
import { auditEvents, projectPages } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

let app: NestExpressApplication;
let pool: pg.Pool;
let admin: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let project: Project;

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
const projects = z.array(projectSchema);
const pages = z.array(pageSchema);

async function member(role: 'designer' | 'viewer' | 'org_owner', team: string) {
  const who = await signIn(app, newIdentity(`Projects ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

beforeAll(async () => {
  ({ app } = await createTestApp());
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  const newTeam = async (name: string) =>
    (
      (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
  teamA = await newTeam(`Projects A ${String(Date.now())}`);
  const teamB = await newTeam(`Projects B ${String(Date.now())}`);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('projects', () => {
  it('are created with a Home page and persisted', async () => {
    const res = await mutate(app, 'post', '/api/v1/projects', designer)
      .send({ name: '  Checkout redesign ', description: 'New checkout flow' })
      .expect(201);
    project = projectSchema.parse(res.body);
    expect(project).toMatchObject({
      name: 'Checkout redesign',
      description: 'New checkout flow',
      status: 'active',
      pageCount: 1,
      createdByName: 'Projects designer',
    });
    expect(project.lastOpenedAt).not.toBeNull();
    const listed = pages.parse(
      (await get(`/api/v1/projects/${project.id}/pages`, viewer).expect(200)).body,
    );
    expect(listed).toMatchObject([{ name: 'Home', route: '/', position: 0 }]);
  });

  it('are listed to every team member, newest first, and hidden from other teams', async () => {
    await mutate(app, 'post', '/api/v1/projects', designer).send({ name: 'Second' }).expect(201);
    const list = projects.parse((await get('/api/v1/projects', viewer).expect(200)).body);
    expect(list.map((p) => p.name)).toEqual(['Second', 'Checkout redesign']);
    expect(projects.parse((await get('/api/v1/projects', outsider).expect(200)).body)).toEqual([]);
    await get(`/api/v1/projects/${project.id}`, outsider).expect(404);
    await get(`/api/v1/projects/${project.id}/pages`, outsider).expect(404);
    await mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, outsider)
      .send({ name: 'X', route: '/x' })
      .expect(404);
  });

  it('are read-only for viewers', async () => {
    await mutate(app, 'post', '/api/v1/projects', viewer).send({ name: 'Nope' }).expect(403);
    await mutate(app, 'patch', `/api/v1/projects/${project.id}`, viewer)
      .send({ name: 'Nope', expectedUpdatedAt: project.updatedAt })
      .expect(403);
    await mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, viewer)
      .send({ name: 'Nope', route: '/nope' })
      .expect(403);
  });

  it('require unique names per team (case-insensitive) and validate input', async () => {
    const dup = await mutate(app, 'post', '/api/v1/projects', designer)
      .send({ name: 'checkout REDESIGN' })
      .expect(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('NAME_TAKEN');
    await mutate(app, 'post', '/api/v1/projects', designer).send({ name: '   ' }).expect(400);
    await mutate(app, 'post', '/api/v1/projects', designer)
      .send({ name: 'x'.repeat(81) })
      .expect(400);
  });

  it('rename with optimistic concurrency', async () => {
    const res = await mutate(app, 'patch', `/api/v1/projects/${project.id}`, designer)
      .send({ name: 'Checkout v2', expectedUpdatedAt: project.updatedAt })
      .expect(200);
    const renamed = projectSchema.parse(res.body);
    expect(renamed.name).toBe('Checkout v2');
    const stale = await mutate(app, 'patch', `/api/v1/projects/${project.id}`, designer)
      .send({ name: 'Lost update', expectedUpdatedAt: project.updatedAt })
      .expect(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe('STALE_UPDATE');
    project = renamed;
  });

  it('record opening for recent projects without counting as an edit', async () => {
    const before = projectSchema.parse(
      (await get(`/api/v1/projects/${project.id}`, viewer).expect(200)).body,
    );
    const opened = projectSchema.parse(
      (await mutate(app, 'post', `/api/v1/projects/${project.id}/open`, viewer).expect(200)).body,
    );
    expect(Date.parse(opened.lastOpenedAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(before.lastOpenedAt ?? ''),
    );
    expect(opened.updatedAt).toBe(before.updatedAt);
  });
});

describe('pages', () => {
  let pricingId: string;
  let pricingUpdatedAt: string;

  it('are created at the end with a validated, unique route', async () => {
    const res = await mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, designer)
      .send({ name: 'Pricing', route: '/pricing' })
      .expect(201);
    const page = pageSchema.parse(res.body);
    expect(page.position).toBe(1);
    pricingId = page.id;
    pricingUpdatedAt = page.updatedAt;
    const dup = await mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, designer)
      .send({ name: 'Pricing 2', route: '/pricing' })
      .expect(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('ROUTE_TAKEN');
    for (const route of ['pricing', '/Pricing', '/a b', '/../etc', '/x/', '//x'])
      await mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, designer)
        .send({ name: 'Bad', route })
        .expect(400);
  });

  it('update the project last-modified time', async () => {
    const after = projectSchema.parse(
      (await get(`/api/v1/projects/${project.id}`, viewer).expect(200)).body,
    );
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(project.updatedAt));
    expect(after.pageCount).toBe(2);
    project = after;
  });

  it('rename with concurrency checks', async () => {
    const res = await mutate(
      app,
      'patch',
      `/api/v1/projects/${project.id}/pages/${pricingId}`,
      designer,
    )
      .send({ name: 'Plans', route: '/plans', expectedUpdatedAt: pricingUpdatedAt })
      .expect(200);
    expect(pageSchema.parse(res.body)).toMatchObject({ name: 'Plans', route: '/plans' });
    await mutate(app, 'patch', `/api/v1/projects/${project.id}/pages/${pricingId}`, designer)
      .send({ name: 'Stale', expectedUpdatedAt: pricingUpdatedAt })
      .expect(409);
  });

  it('are deleted, but never the last one', async () => {
    await mutate(
      app,
      'delete',
      `/api/v1/projects/${project.id}/pages/${pricingId}`,
      designer,
    ).expect(204);
    const remaining = pages.parse(
      (await get(`/api/v1/projects/${project.id}/pages`, designer).expect(200)).body,
    );
    expect(remaining).toHaveLength(1);
    const last = await mutate(
      app,
      'delete',
      `/api/v1/projects/${project.id}/pages/${remaining[0]?.id ?? ''}`,
      designer,
    ).expect(409);
    expect((last.body as { error: { code: string } }).error.code).toBe('LAST_PAGE');
    expect(
      pages.parse((await get(`/api/v1/projects/${project.id}/pages`, designer).expect(200)).body),
    ).toHaveLength(1);
  });

  it('cannot be moved across projects by id', async () => {
    const other = projectSchema.parse(
      (await mutate(app, 'post', '/api/v1/projects', designer).send({ name: 'Other' }).expect(201))
        .body,
    );
    const [home] = pages.parse(
      (await get(`/api/v1/projects/${other.id}/pages`, designer).expect(200)).body,
    );
    await mutate(
      app,
      'delete',
      `/api/v1/projects/${project.id}/pages/${home?.id ?? ''}`,
      designer,
    ).expect(404);
  });

  it('enforce same-team ownership in the database', async () => {
    await expect(
      withTenant(createDatabase(pool), teamA, (tx) =>
        tx.insert(projectPages).values({
          projectId: project.id,
          organizationId: '00000000-0000-4000-8000-000000000000',
          name: 'Smuggled',
          route: '/smuggled',
          position: 9,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('archiving', () => {
  it('moves the project to the archived list and freezes pages', async () => {
    project = projectSchema.parse(
      (await get(`/api/v1/projects/${project.id}`, designer).expect(200)).body,
    );
    const res = await mutate(app, 'patch', `/api/v1/projects/${project.id}`, designer)
      .send({ status: 'archived', expectedUpdatedAt: project.updatedAt })
      .expect(200);
    project = projectSchema.parse(res.body);
    const active = projects.parse((await get('/api/v1/projects', designer).expect(200)).body);
    expect(active.some((p) => p.id === project.id)).toBe(false);
    const archived = projects.parse(
      (await get('/api/v1/projects?status=archived', designer).expect(200)).body,
    );
    expect(archived.map((p) => p.id)).toContain(project.id);
    const frozen = await mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, designer)
      .send({ name: 'Late', route: '/late' })
      .expect(409);
    expect((frozen.body as { error: { code: string } }).error.code).toBe('PROJECT_ARCHIVED');
  });

  it('frees the name while archived and restores', async () => {
    await mutate(app, 'post', '/api/v1/projects', designer)
      .send({ name: 'Checkout v2' })
      .expect(201);
    const clash = await mutate(app, 'patch', `/api/v1/projects/${project.id}`, designer)
      .send({ status: 'active', expectedUpdatedAt: project.updatedAt })
      .expect(409);
    expect((clash.body as { error: { code: string } }).error.code).toBe('NAME_TAKEN');
    const restored = await mutate(app, 'patch', `/api/v1/projects/${project.id}`, designer)
      .send({
        status: 'active',
        name: 'Checkout v2 (restored)',
        expectedUpdatedAt: project.updatedAt,
      })
      .expect(200);
    expect(projectSchema.parse(restored.body)).toMatchObject({
      status: 'active',
      name: 'Checkout v2 (restored)',
    });
  });

  it('is fully audited', async () => {
    const rows = await withTenant(createDatabase(pool), teamA, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.targetType, 'project')),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'project.created',
      'project.updated',
      'project.archived',
      'project.restored',
    ])
      expect(actions).toContain(action);
    const pageRows = await withTenant(createDatabase(pool), teamA, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.targetType, 'project_page')),
    );
    expect(new Set(pageRows.map((r) => r.action))).toEqual(
      new Set(['page.created', 'page.updated', 'page.deleted']),
    );
  });
});
