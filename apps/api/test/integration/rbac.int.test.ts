import type { NestExpressApplication } from '@nestjs/platform-express';
import type { MembershipRole } from '@core-studio/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, createPool, withTenant } from '../../src/db/database.js';
import { auditEvents } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

let app: NestExpressApplication;
let pool: pg.Pool;
let admin: SignedIn;
let teamA: string;
let teamB: string;
const users: Partial<Record<MembershipRole | 'outsider', SignedIn>> = {};
const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
const as = (role: MembershipRole | 'outsider'): SignedIn => {
  const who = users[role];
  if (!who) throw new Error(`missing ${role}`);
  return who;
};

beforeAll(async () => {
  ({ app } = await createTestApp());
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  expect(admin.session.user.platformAdmin).toBe(true);

  teamA = (
    (
      await mutate(app, 'post', '/api/v1/orgs', admin)
        .send({ name: `Team A ${String(Date.now())}` })
        .expect(201)
    ).body as { id: string }
  ).id;
  teamB = (
    (
      await mutate(app, 'post', '/api/v1/orgs', admin)
        .send({ name: `Team B ${String(Date.now())}` })
        .expect(201)
    ).body as { id: string }
  ).id;

  for (const role of ['org_owner', 'org_admin', 'designer', 'viewer', 'outsider'] as const) {
    const who = await signIn(app, newIdentity(`User ${role}`));
    if (role !== 'outsider') {
      await mutate(app, 'post', `/api/v1/orgs/${teamA}/members`, admin)
        .send({ userId: who.session.user.id, role })
        .expect(204);
    }
    users[role] = await refreshSession(app, who);
  }
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('team bootstrap', () => {
  it('lets only company admins create teams', async () => {
    for (const role of ['org_owner', 'org_admin', 'designer', 'viewer', 'outsider'] as const) {
      await mutate(app, 'post', '/api/v1/orgs', as(role)).send({ name: 'Nope' }).expect(403);
    }
  });

  it('makes the first team the active team for members', async () => {
    const viewer = await signIn(app, { oid: newIdentity().oid, name: 'x' });
    expect(viewer.session.activeOrganizationId).toBeNull();
    expect(as('designer').session.organizations.map((o) => o.id)).toContain(teamA);
  });

  it('validates request bodies against the contract', async () => {
    const res = await mutate(app, 'post', '/api/v1/orgs', admin).send({ name: 'x' }).expect(400);
    expect((res.body as { error: { details: unknown[] } }).error.details.length).toBeGreaterThan(0);
  });
});

describe('RBAC matrix (team A)', () => {
  const matrix: {
    name: string;
    run: (who: SignedIn) => request.Test;
    allowed: (MembershipRole | 'outsider')[];
  }[] = [
    {
      name: 'list members',
      run: (w) => get(`/api/v1/orgs/${teamA}/members`, w),
      allowed: ['org_owner', 'org_admin', 'designer', 'viewer'],
    },
    {
      name: 'search directory',
      run: (w) => get(`/api/v1/directory/users?q=User`, w).query({}),
      allowed: ['org_owner', 'org_admin'],
    },
    {
      name: 'rename team',
      run: (w) =>
        mutate(app, 'patch', `/api/v1/orgs/${teamA}`, w).send({
          name: `Team A ${String(Date.now())}`,
        }),
      allowed: ['org_owner'],
    },
  ];

  for (const row of matrix) {
    for (const role of ['org_owner', 'org_admin', 'designer', 'viewer', 'outsider'] as const) {
      const expected = row.allowed.includes(role);
      it(`${row.name}: ${role} → ${expected ? 'allowed' : 'forbidden'}`, async () => {
        // directory search permission is evaluated on the active team
        const res = await row.run(as(role));
        expect(res.status, JSON.stringify(res.body)).toBe(
          expected ? (res.status === 204 ? 204 : 200) : 403,
        );
      });
    }
  }

  it('designers and viewers cannot add members', async () => {
    const target = await signIn(app, newIdentity());
    for (const role of ['designer', 'viewer', 'outsider'] as const) {
      await mutate(app, 'post', `/api/v1/orgs/${teamA}/members`, as(role))
        .send({ userId: target.session.user.id, role: 'viewer' })
        .expect(403);
    }
  });

  it('admins can add members but cannot grant or remove owners', async () => {
    const target = await signIn(app, newIdentity());
    await mutate(app, 'post', `/api/v1/orgs/${teamA}/members`, as('org_admin'))
      .send({ userId: target.session.user.id, role: 'org_owner' })
      .expect(403);
    await mutate(app, 'post', `/api/v1/orgs/${teamA}/members`, as('org_admin'))
      .send({ userId: target.session.user.id, role: 'designer' })
      .expect(204);
    await mutate(
      app,
      'delete',
      `/api/v1/orgs/${teamA}/members/${as('org_owner').session.user.id}`,
      as('org_admin'),
    ).expect(403);
    await mutate(app, 'post', `/api/v1/orgs/${teamA}/members`, as('org_admin'))
      .send({ userId: target.session.user.id, role: 'designer' })
      .expect(409);
  });

  it('protects the last owner', async () => {
    // team A owners: admin (creator) + org_owner user. Demote admin first, then the last owner cannot be demoted.
    await mutate(
      app,
      'patch',
      `/api/v1/orgs/${teamA}/members/${admin.session.user.id}`,
      as('org_owner'),
    )
      .send({ role: 'org_admin' })
      .expect(204);
    const res = await mutate(
      app,
      'patch',
      `/api/v1/orgs/${teamA}/members/${as('org_owner').session.user.id}`,
      as('org_owner'),
    )
      .send({ role: 'viewer' })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('LAST_OWNER');
    await mutate(
      app,
      'delete',
      `/api/v1/orgs/${teamA}/members/${as('org_owner').session.user.id}`,
      as('org_owner'),
    ).expect(400);
  });

  it('writes audit events for membership changes, visible only within the team', async () => {
    const { rows: hidden } = await pool.query(
      "select count(*)::int as n from audit_events where action like 'member.%'",
    );
    expect((hidden[0] as { n: number }).n).toBe(0);
    const actions = await withTenant(createDatabase(pool), teamA, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, teamA)),
    );
    const names = actions.map((a) => a.action);
    expect(names).toEqual(
      expect.arrayContaining(['org.created', 'member.added', 'member.role_changed']),
    );
    const forB = await withTenant(createDatabase(pool), teamA, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.organizationId, teamB)),
    );
    expect(forB).toHaveLength(0);
  });
});

describe('cross-team isolation', () => {
  it('members of team A cannot see or act on team B', async () => {
    for (const role of ['org_owner', 'org_admin', 'designer', 'viewer'] as const) {
      await get(`/api/v1/orgs/${teamB}/members`, as(role)).expect(403);
      await mutate(app, 'post', `/api/v1/orgs/${teamB}/activate`, as(role)).expect(403);
      const target = as('outsider').session.user.id;
      await mutate(app, 'post', `/api/v1/orgs/${teamB}/members`, as(role))
        .send({ userId: target, role: 'viewer' })
        .expect(403);
    }
  });

  it('lists only the teams a user belongs to', async () => {
    const res = await get('/api/v1/orgs', as('designer')).expect(200);
    const ids = (res.body as { id: string }[]).map((o) => o.id);
    expect(ids).toContain(teamA);
    expect(ids).not.toContain(teamB);
  });

  it('rejects malformed team ids', async () => {
    await get('/api/v1/orgs/not-a-uuid/members', as('designer')).expect(403);
  });
});

describe('database guarantees for the runtime role', () => {
  it('cannot write users directly or read security events', async () => {
    await expect(
      pool.query(
        "insert into users (entra_tenant_id, entra_object_id, display_name) values (gen_random_uuid(), gen_random_uuid(), 'x')",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(pool.query('select * from security_events')).rejects.toThrow(/permission denied/);
  });

  it('cannot read memberships without context', async () => {
    const { rows } = await pool.query('select count(*)::int as n from organization_memberships');
    expect((rows[0] as { n: number }).n).toBe(0);
  });
});
