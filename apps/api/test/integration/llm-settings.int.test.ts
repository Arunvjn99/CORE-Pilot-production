import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  credentialSummarySchema,
  credentialTestResultSchema,
  defaultModelResponseSchema,
  llmActivitySchema,
} from '@core-studio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp, TEST_LOCAL_KEK } from './support/app.js';
import {
  mutate,
  newIdentity,
  refreshSession,
  type SignedIn,
  signIn,
  stepUp,
} from './support/oidc.js';
import {
  type FakeProvider,
  type RealRuntime,
  startFakeOllama,
  startRuntime,
} from './support/runtime.js';

const TEAM_SECRET = 'ollama-TEAMKEY-0123456789abcdef';
const PERSONAL_SECRET = 'ollama-PERSONAL-fedcba9876543210';
const PLATFORM_SECRET = 'ollama-PLATFORM-aabbccddeeff0011';
const TOKEN_SCOPE = 'api://core-ai-runtime/.default';
const CLIENT_ID = 'core-studio-test';

let app: NestExpressApplication;
let runtime: RealRuntime;
let teamProvider: FakeProvider;
let personalProvider: FakeProvider;
let platformProvider: FakeProvider;
let admin: SignedIn;
let owner: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let teamB: string;
let teamCredential: string;
let personalCredential: string;
let platformCredential: string;

const server = () => app.getHttpServer();
const get = (path: string, who: SignedIn) => request(server()).get(path).set('Cookie', who.cookie);
const test = (who: SignedIn, id: string) =>
  mutate(app, 'post', `/api/v1/llm/credentials/${id}/test`, who);

async function newTeam(name: string): Promise<string> {
  return (
    (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
      id: string;
    }
  ).id;
}

async function member(role: 'org_owner' | 'designer' | 'viewer', team: string): Promise<SignedIn> {
  const who = await signIn(app, newIdentity(`Gateway ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

beforeAll(async () => {
  [teamProvider, personalProvider, platformProvider] = await Promise.all([
    startFakeOllama(TEAM_SECRET, ['llama3.2:3b', 'qwen2.5:7b']),
    startFakeOllama(PERSONAL_SECRET, ['mistral:7b']),
    startFakeOllama(PLATFORM_SECRET, ['phi4:14b']),
  ]);
  runtime = await startRuntime({
    localKek: TEST_LOCAL_KEK,
    issuer: requireEnv('TEST_OIDC_ISSUER_URL'),
    audience: TOKEN_SCOPE,
    allowedCaller: CLIENT_ID,
  });
  ({ app } = await createTestApp({
    AI_RUNTIME_URL: runtime.url,
    AI_RUNTIME_TOKEN_SCOPE: TOKEN_SCOPE,
  }));
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  const suffix = String(Date.now());
  teamA = await newTeam(`Gateway A ${suffix}`);
  teamB = await newTeam(`Gateway B ${suffix}`);
  owner = await member('org_owner', teamA);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);

  await stepUp(app, owner);
  teamCredential = credentialSummarySchema.parse(
    (
      await mutate(app, 'post', '/api/v1/llm/credentials', owner)
        .send({
          scope: 'organization',
          provider: 'ollama',
          label: 'Team Ollama',
          endpoint: teamProvider.url,
          secret: TEAM_SECRET,
        })
        .expect(201)
    ).body,
  ).id;
  await mutate(app, 'put', '/api/v1/llm/policy', owner)
    .send({ allowPersonalCredentials: true })
    .expect(204);
  await stepUp(app, designer);
  personalCredential = credentialSummarySchema.parse(
    (
      await mutate(app, 'post', '/api/v1/llm/credentials', designer)
        .send({
          scope: 'user',
          provider: 'ollama',
          label: 'My Ollama',
          endpoint: personalProvider.url,
          secret: PERSONAL_SECRET,
        })
        .expect(201)
    ).body,
  ).id;
  await stepUp(app, admin);
  platformCredential = (
    (
      await mutate(app, 'post', '/api/v1/platform/llm-credentials', admin)
        .send({
          provider: 'ollama',
          label: 'Company Ollama',
          endpoint: platformProvider.url,
          secret: PLATFORM_SECRET,
        })
        .expect(201)
    ).body as { id: string }
  ).id;
  await mutate(
    app,
    'put',
    `/api/v1/platform/llm-credentials/${platformCredential}/entitlements`,
    admin,
  )
    .send({ organizationIds: [teamA] })
    .expect(204);
}, 120_000);

afterAll(async () => {
  await app.close();
  await runtime.stop();
  await Promise.all([teamProvider.close(), personalProvider.close(), platformProvider.close()]);
});

describe('connection test through the real AI runtime', () => {
  it('decrypts the stored key in the runtime and lists models', async () => {
    const res = await test(owner, teamCredential).expect(200);
    const result = credentialTestResultSchema.parse(res.body);
    expect(result).toMatchObject({ code: 'ok', models: ['llama3.2:3b', 'qwen2.5:7b'] });
    expect(teamProvider.seenAuthorization.at(-1)).toBe(`Bearer ${TEAM_SECRET}`);
    expect(JSON.stringify(res.body)).not.toContain(TEAM_SECRET);

    const listed = z
      .array(credentialSummarySchema)
      .parse((await get('/api/v1/llm/credentials', viewer).expect(200)).body)
      .find((row) => row.id === teamCredential);
    expect(listed).toMatchObject({ lastTestCode: 'ok' });
    expect(listed?.lastTestedAt).not.toBeNull();
  });

  it('reports a rejected key with a fixed code and never relays the upstream body', async () => {
    await stepUp(app, owner);
    await mutate(app, 'post', `/api/v1/llm/credentials/${teamCredential}/rotate`, owner)
      .send({ secret: 'ollama-WRONG-000000000000000000' })
      .expect(204);
    const res = await test(owner, teamCredential).expect(200);
    expect(res.body).toMatchObject({ code: 'unauthorized', models: [] });
    expect(JSON.stringify(res.body)).not.toContain('upstream-detail-must-not-leak');
    await mutate(app, 'post', `/api/v1/llm/credentials/${teamCredential}/rotate`, owner)
      .send({ secret: TEAM_SECRET })
      .expect(204);
    expect((await test(owner, teamCredential).expect(200)).body).toMatchObject({ code: 'ok' });
  });

  it('enforces who may test which credential', async () => {
    await test(designer, teamCredential).expect(403);
    await test(viewer, teamCredential).expect(403);
    await test(outsider, teamCredential).expect(404);
    // Personal credentials: only the owner, even a team owner cannot see them.
    await test(owner, personalCredential).expect(404);
    expect((await test(designer, personalCredential).expect(200)).body).toMatchObject({
      code: 'ok',
      models: ['mistral:7b'],
    });
    expect(personalProvider.seenAuthorization.at(-1)).toBe(`Bearer ${PERSONAL_SECRET}`);
  });

  it('requires CSRF protection', async () => {
    await request(server())
      .post(`/api/v1/llm/credentials/${teamCredential}/test`)
      .set('Cookie', owner.cookie)
      .expect(403);
  });

  it('lets entitled team managers and company admins test company credentials', async () => {
    expect((await test(owner, platformCredential).expect(200)).body).toMatchObject({
      code: 'ok',
      models: ['phi4:14b'],
    });
    await test(outsider, platformCredential).expect(404);
    expect(
      (
        await mutate(
          app,
          'post',
          `/api/v1/platform/llm-credentials/${platformCredential}/test`,
          admin,
        )
          .send()
          .expect(200)
      ).body,
    ).toMatchObject({ code: 'ok' });
    await mutate(app, 'post', `/api/v1/platform/llm-credentials/${platformCredential}/test`, owner)
      .send()
      .expect(403);
  });
});

describe('default model', () => {
  const defaultFor = async (who: SignedIn) =>
    defaultModelResponseSchema.parse((await get('/api/v1/llm/default-model', who).expect(200)).body)
      .defaultModel;

  it('starts unset and only managers can set it', async () => {
    expect(await defaultFor(viewer)).toBeNull();
    await mutate(app, 'put', '/api/v1/llm/default-model', designer)
      .send({ credentialId: teamCredential, model: 'llama3.2:3b' })
      .expect(403);
  });

  it('accepts a team credential and rejects personal or unknown ones', async () => {
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: teamCredential, model: 'llama3.2:3b' })
      .expect(204);
    expect(await defaultFor(viewer)).toMatchObject({
      credentialId: teamCredential,
      credentialScope: 'organization',
      provider: 'ollama',
      model: 'llama3.2:3b',
    });
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: personalCredential, model: 'mistral:7b' })
      .expect(404);
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: teamCredential, model: 'bad model; drop' })
      .expect(400);
  });

  it('is isolated per team', async () => {
    expect(await defaultFor(outsider)).toBeNull();
    await mutate(app, 'put', '/api/v1/llm/default-model', outsider)
      .send({ credentialId: teamCredential, model: 'llama3.2:3b' })
      .expect(404);
  });

  it('can use an entitled company credential and is cleared when access is removed', async () => {
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: platformCredential, model: 'phi4:14b' })
      .expect(204);
    expect(await defaultFor(owner)).toMatchObject({
      credentialScope: 'platform',
      credentialLabel: 'Company Ollama',
    });
    await stepUp(app, admin);
    await mutate(
      app,
      'put',
      `/api/v1/platform/llm-credentials/${platformCredential}/entitlements`,
      admin,
    )
      .send({ organizationIds: [] })
      .expect(204);
    expect(await defaultFor(owner)).toBeNull();
  });

  it('is cleared when its credential is revoked', async () => {
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: teamCredential, model: 'qwen2.5:7b' })
      .expect(204);
    await stepUp(app, owner);
    await mutate(app, 'delete', `/api/v1/llm/credentials/${teamCredential}`, owner).expect(204);
    expect(await defaultFor(owner)).toBeNull();
    await test(owner, teamCredential).expect(404);
  });
});

describe('activity feed', () => {
  const feed = async (who: SignedIn) =>
    z.array(llmActivitySchema).parse((await get('/api/v1/llm/activity', who).expect(200)).body);

  it('shows team events with actor names and outcomes, newest first', async () => {
    const events = await feed(viewer);
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'llm_credential.created',
        'llm_credential.tested',
        'llm_credential.revoked',
        'llm_default_model.updated',
        'llm_policy.updated',
      ]),
    );
    expect(events.find((e) => e.action === 'llm_credential.tested')).toMatchObject({
      actorName: 'Gateway org_owner',
      provider: 'ollama',
    });
    const times = events.map((e) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("hides other people's personal-credential events", async () => {
    const own = (await feed(designer)).filter((e) => e.scope === 'user');
    expect(own.length).toBeGreaterThan(0);
    expect((await feed(owner)).some((e) => e.scope === 'user')).toBe(false);
    expect((await feed(viewer)).some((e) => e.scope === 'user')).toBe(false);
  });

  it('is scoped to the active team and never contains secrets', async () => {
    const other = await feed(outsider);
    expect(other.some((e) => e.targetId === teamCredential)).toBe(false);
    const body = JSON.stringify(await feed(owner));
    for (const secret of [TEAM_SECRET, PERSONAL_SECRET, PLATFORM_SECRET])
      expect(body).not.toContain(secret);
  });
});

// Last: creating a second app flushes the shared session store.
describe('runtime outage', () => {
  it('reports the runtime as unavailable instead of failing the request', async () => {
    const { app: offline } = await createTestApp({ AI_RUNTIME_URL: 'http://127.0.0.1:9' });
    try {
      const who = await signIn(offline, owner.identity);
      await stepUp(offline, who);
      const credential = credentialSummarySchema.parse(
        (
          await mutate(offline, 'post', '/api/v1/llm/credentials', who)
            .send({
              scope: 'organization',
              provider: 'ollama',
              label: 'Outage',
              endpoint: teamProvider.url,
              secret: TEAM_SECRET,
            })
            .expect(201)
        ).body,
      );
      const res = await mutate(
        offline,
        'post',
        `/api/v1/llm/credentials/${credential.id}/test`,
        who,
      ).expect(200);
      expect(res.body).toMatchObject({ code: 'runtime_unavailable', models: [] });
    } finally {
      await offline.close();
    }
  });
});
