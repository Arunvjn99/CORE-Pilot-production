import { PassThrough } from 'node:stream';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type CredentialSummary, credentialSummarySchema } from '@core-studio/contracts';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext, withTenant } from '../../src/db/database.js';
import { auditEvents, llmCredentials } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp } from './support/app.js';
import {
  mutate,
  newIdentity,
  refreshSession,
  type SignedIn,
  signIn,
  stepUp,
} from './support/oidc.js';

const SECRET = 'sk-live-SUPERSECRET-0123456789abcdef';
const ROTATED = 'sk-live-ROTATED-fedcba9876543210';
const PERSONAL = 'sk-ant-PERSONAL-0011223344556677';
const PLATFORM = 'sk-platform-SHARED-aabbccddeeff0011';
const ALL_SECRETS = [SECRET, ROTATED, PERSONAL, PLATFORM];

let app: NestExpressApplication;
let pool: pg.Pool;
let logs = '';
let admin: SignedIn;
let owner: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let otherTeamOwner: SignedIn;
let teamA: string;
let teamB: string;
const list = z.array(credentialSummarySchema);

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
const listFor = async (who: SignedIn): Promise<CredentialSummary[]> =>
  list.parse((await get('/api/v1/llm/credentials', who).expect(200)).body);

async function member(role: 'org_owner' | 'designer' | 'viewer', team: string): Promise<SignedIn> {
  const who = await signIn(app, newIdentity(`Cred ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

beforeAll(async () => {
  const logStream = new PassThrough();
  logStream.on('data', (chunk: Buffer) => {
    logs += chunk.toString('utf8');
  });
  ({ app } = await createTestApp({ LOG_LEVEL: 'trace' }, undefined, { logStream }));
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  teamA = (
    (
      await mutate(app, 'post', '/api/v1/orgs', admin)
        .send({ name: `Cred A ${String(Date.now())}` })
        .expect(201)
    ).body as { id: string }
  ).id;
  teamB = (
    (
      await mutate(app, 'post', '/api/v1/orgs', admin)
        .send({ name: `Cred B ${String(Date.now())}` })
        .expect(201)
    ).body as { id: string }
  ).id;
  owner = await member('org_owner', teamA);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  otherTeamOwner = await member('org_owner', teamB);
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('team credentials', () => {
  it('require a recent re-authentication to create', async () => {
    const res = await mutate(app, 'post', '/api/v1/llm/credentials', owner)
      .send({ scope: 'organization', provider: 'openai', label: 'Main', secret: SECRET })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('REAUTH_REQUIRED');
  });

  it('are stored encrypted and never returned', async () => {
    await stepUp(app, owner);
    const res = await mutate(app, 'post', '/api/v1/llm/credentials', owner)
      .send({ scope: 'organization', provider: 'openai', label: 'Main', secret: SECRET })
      .expect(201);
    const created = credentialSummarySchema.parse(res.body);
    expect(created).toMatchObject({
      scope: 'organization',
      provider: 'openai',
      hasSecret: true,
      displayHint: '…cdef',
      status: 'active',
    });
    expect(JSON.stringify(res.body)).not.toContain('SUPERSECRET');

    const [row] = await withTenant(createDatabase(pool), teamA, (tx) =>
      tx.select().from(llmCredentials).where(eq(llmCredentials.id, created.id)),
    );
    expect(row?.ciphertext).toBeInstanceOf(Buffer);
    expect(row?.ciphertext?.includes(Buffer.from('SUPERSECRET'))).toBe(false);
    expect(row?.wrappedDek?.length).toBe(60);
    expect(row).toMatchObject({ kekId: 'local', wrapAlgorithm: 'A256GCM-KW', envelopeVersion: 1 });
  });

  it('are listed with metadata only, to every team member', async () => {
    for (const who of [owner, designer, viewer]) {
      const rows = await listFor(who);
      expect(rows.some((r) => r.label === 'Main')).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/SUPERSECRET|ciphertext|wrappedDek/);
    }
  });

  it('cannot be created by designers or viewers at team scope', async () => {
    for (const who of [designer, viewer]) {
      await stepUp(app, who);
      await mutate(app, 'post', '/api/v1/llm/credentials', who)
        .send({ scope: 'organization', provider: 'anthropic', label: 'Nope', secret: SECRET })
        .expect(403);
    }
  });

  it('validate provider-specific fields', async () => {
    const bad = [
      {
        scope: 'organization',
        provider: 'azure_openai',
        label: 'AOAI',
        secret: SECRET,
        endpoint: 'https://x.openai.azure.com',
      },
      {
        scope: 'organization',
        provider: 'openai',
        label: 'X',
        secret: SECRET,
        endpoint: 'https://evil.test',
      },
      { scope: 'organization', provider: 'anthropic', label: 'X' },
      { scope: 'organization', provider: 'openai', label: 'X', secret: ` ${SECRET}` },
    ];
    for (const body of bad)
      await mutate(app, 'post', '/api/v1/llm/credentials', owner).send(body).expect(400);
    await mutate(app, 'post', '/api/v1/llm/credentials', owner)
      .send({
        scope: 'organization',
        provider: 'azure_openai',
        label: 'AOAI',
        secret: SECRET,
        endpoint: 'https://x.openai.azure.com',
        deployment: 'gpt-dep',
        apiVersion: '2026-06-01',
      })
      .expect(201);
    const ollama = await mutate(app, 'post', '/api/v1/llm/credentials', owner)
      .send({
        scope: 'organization',
        provider: 'ollama',
        label: 'Local',
        endpoint: 'http://ollama.internal:11434',
      })
      .expect(201);
    expect(credentialSummarySchema.parse(ollama.body).hasSecret).toBe(false);
  });

  it('rotate to new key material and revoke by destroying it', async () => {
    const main = (await listFor(owner)).find((r) => r.label === 'Main');
    if (!main) throw new Error('missing');
    const db = createDatabase(pool);
    const [before] = await withTenant(db, teamA, (tx) =>
      tx.select().from(llmCredentials).where(eq(llmCredentials.id, main.id)),
    );
    await mutate(app, 'post', `/api/v1/llm/credentials/${main.id}/rotate`, owner)
      .send({ secret: ROTATED })
      .expect(204);
    const [after] = await withTenant(db, teamA, (tx) =>
      tx.select().from(llmCredentials).where(eq(llmCredentials.id, main.id)),
    );
    expect(after?.ciphertext?.equals(before?.ciphertext ?? Buffer.alloc(0))).toBe(false);
    expect(after?.wrappedDek?.equals(before?.wrappedDek ?? Buffer.alloc(0))).toBe(false);
    expect(after?.rotatedAt).not.toBeNull();
    expect(after?.displayHint).toBe('…3210');

    await mutate(app, 'delete', `/api/v1/llm/credentials/${main.id}`, viewer).expect(403);
    await mutate(app, 'delete', `/api/v1/llm/credentials/${main.id}`, owner).expect(204);
    const [revoked] = await withTenant(db, teamA, (tx) =>
      tx.select().from(llmCredentials).where(eq(llmCredentials.id, main.id)),
    );
    expect(revoked).toMatchObject({
      status: 'revoked',
      ciphertext: null,
      wrappedDek: null,
      iv: null,
      authTag: null,
    });
    await mutate(app, 'delete', `/api/v1/llm/credentials/${main.id}`, owner).expect(404);
    await mutate(app, 'post', `/api/v1/llm/credentials/${main.id}/rotate`, owner)
      .send({ secret: SECRET })
      .expect(404);
  });

  it('are invisible to other teams', async () => {
    const rows = await listFor(otherTeamOwner);
    expect(rows.filter((r) => r.scope !== 'platform')).toEqual([]);
    const teamACred = (await listFor(owner))[0];
    await stepUp(app, otherTeamOwner);
    await mutate(
      app,
      'delete',
      `/api/v1/llm/credentials/${teamACred?.id ?? ''}`,
      otherTeamOwner,
    ).expect(404);
  });

  it('write audit events without secret material', async () => {
    const events = await withTenant(createDatabase(pool), teamA, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.organizationId, teamA)),
    );
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'llm_credential.created',
        'llm_credential.rotated',
        'llm_credential.revoked',
      ]),
    );
    const serialized = JSON.stringify(events);
    for (const secret of ALL_SECRETS) expect(serialized).not.toContain(secret);
  });
});

describe('personal credentials', () => {
  it('are blocked until the team enables them', async () => {
    await stepUp(app, designer);
    const res = await mutate(app, 'post', '/api/v1/llm/credentials', designer)
      .send({ scope: 'user', provider: 'anthropic', label: 'Mine', secret: PERSONAL })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'PERSONAL_CREDENTIALS_DISABLED',
    );
  });

  it('policy changes need providers:manage and re-authentication', async () => {
    await mutate(app, 'put', '/api/v1/llm/policy', designer)
      .send({ allowPersonalCredentials: true })
      .expect(403);
    await mutate(app, 'put', '/api/v1/llm/policy', owner)
      .send({ allowPersonalCredentials: true })
      .expect(204);
    expect((await get('/api/v1/llm/policy', viewer).expect(200)).body).toEqual({
      allowPersonalCredentials: true,
    });
  });

  it('are visible and manageable only by their owner (enforced by RLS)', async () => {
    const created = credentialSummarySchema.parse(
      (
        await mutate(app, 'post', '/api/v1/llm/credentials', designer)
          .send({ scope: 'user', provider: 'anthropic', label: 'Mine', secret: PERSONAL })
          .expect(201)
      ).body,
    );
    expect((await listFor(designer)).some((r) => r.id === created.id)).toBe(true);
    expect((await listFor(owner)).some((r) => r.id === created.id)).toBe(false);
    expect((await listFor(admin)).some((r) => r.id === created.id)).toBe(false);
    await mutate(app, 'delete', `/api/v1/llm/credentials/${created.id}`, owner).expect(404);

    const db = createDatabase(pool);
    const asOwner = await withDbContext(
      db,
      { organizationId: teamA, userId: owner.session.user.id },
      (tx) => tx.select().from(llmCredentials).where(eq(llmCredentials.id, created.id)),
    );
    expect(asOwner).toHaveLength(0);
    await mutate(app, 'delete', `/api/v1/llm/credentials/${created.id}`, designer).expect(204);
  });

  it('viewers cannot hold personal credentials', async () => {
    await stepUp(app, viewer);
    await mutate(app, 'post', '/api/v1/llm/credentials', viewer)
      .send({ scope: 'user', provider: 'openai', label: 'V', secret: PERSONAL })
      .expect(403);
  });
});

describe('company-managed credentials', () => {
  let platformId = '';

  it('are managed only by company admins with re-authentication', async () => {
    await mutate(app, 'post', '/api/v1/platform/llm-credentials', owner)
      .send({ provider: 'openai', label: 'Shared', secret: PLATFORM })
      .expect(403);
    await mutate(app, 'post', '/api/v1/platform/llm-credentials', admin)
      .send({ provider: 'openai', label: 'Shared', secret: PLATFORM })
      .expect(403);
    await stepUp(app, admin);
    platformId = (
      (
        await mutate(app, 'post', '/api/v1/platform/llm-credentials', admin)
          .send({ provider: 'openai', label: 'Shared', secret: PLATFORM })
          .expect(201)
      ).body as { id: string }
    ).id;
  });

  it('are visible to a team only after entitlement', async () => {
    expect((await listFor(owner)).some((r) => r.id === platformId)).toBe(false);
    await mutate(app, 'put', `/api/v1/platform/llm-credentials/${platformId}/entitlements`, admin)
      .send({ organizationIds: [teamA] })
      .expect(204);
    const forA = (await listFor(owner)).find((r) => r.id === platformId);
    expect(forA).toMatchObject({ scope: 'platform', label: 'Shared', displayHint: '…0011' });
    expect((await listFor(otherTeamOwner)).some((r) => r.id === platformId)).toBe(false);
    await mutate(app, 'put', `/api/v1/platform/llm-credentials/${platformId}/entitlements`, admin)
      .send({ organizationIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
  });

  it('revocation removes entitlements and destroys key material', async () => {
    await mutate(app, 'delete', `/api/v1/platform/llm-credentials/${platformId}`, admin).expect(
      204,
    );
    expect((await listFor(owner)).some((r) => r.id === platformId)).toBe(false);
    const listed = (await get('/api/v1/platform/llm-credentials', admin).expect(200)).body as {
      id: string;
      status: string;
      entitledOrganizationIds: string[];
    }[];
    expect(listed.find((r) => r.id === platformId)).toMatchObject({
      status: 'revoked',
      entitledOrganizationIds: [],
    });
  });
});

describe('secret hygiene', () => {
  it('never writes any secret to logs', () => {
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of ALL_SECRETS) expect(logs).not.toContain(secret);
    // OAuth callback codes and state are one-time secrets: logged requests carry them redacted.
    expect(logs).toContain('/api/v1/auth/callback?code=%5BREDACTED%5D');
    expect(logs).not.toMatch(/callback\?code=(?!%5BREDACTED%5D)/);
    expect(logs).not.toMatch(/"code":"(?!\[REDACTED\])[A-Za-z0-9_-]{20,}"/);
  });

  it('the runtime role cannot delete credentials or bypass destruction on revoke', async () => {
    await expect(pool.query('delete from llm_credentials')).rejects.toThrow(/permission denied/);
    const db = createDatabase(pool);
    const [anyActive] = await withTenant(db, teamA, (tx) =>
      tx
        .select({ id: llmCredentials.id })
        .from(llmCredentials)
        .where(eq(llmCredentials.status, 'active')),
    );
    if (!anyActive) throw new Error('expected an active credential');
    await expect(
      withTenant(db, teamA, (tx) =>
        tx
          .update(llmCredentials)
          .set({ status: 'revoked' })
          .where(eq(llmCredentials.id, anyActive.id)),
      ),
    ).rejects.toThrow();
  });
});
