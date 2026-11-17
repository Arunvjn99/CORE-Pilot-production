import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  agentDefinitionSchema,
  agentVersionSchema,
  credentialSummarySchema,
  designSystemSchema,
  designSystemSummarySchema,
  metricsSchema,
  projectDesignSchema,
  projectSchema,
  type RunEvent,
  runEventSchema,
  runSchema,
  type Run,
  screensResponseSchema,
  sourceEditResultSchema,
  studioConfigSchema,
} from '@core-studio/contracts';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { generationRuns, runSteps } from '../../src/db/schema.js';
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
  type FakeDesignProvider,
  fakeScreenCode,
  type RealRuntime,
  startFakeDesignOllama,
  startRuntime,
} from './support/runtime.js';

const SECRET = 'ollama-STUDIO-0123456789abcdef';
const TOKEN_SCOPE = 'api://core-ai-runtime/.default';
const CLIENT_ID = 'core-studio-test';

let app: NestExpressApplication;
let runtime: RealRuntime;
let provider: FakeDesignProvider;
let pool: Pool;
let admin: SignedIn;
let owner: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let teamB: string;
let projectId: string;
let outsiderProjectId: string;

const server = () => app.getHttpServer();
const get = (path: string, who: SignedIn) => request(server()).get(path).set('Cookie', who.cookie);
const agents = z.array(agentDefinitionSchema);
const systems = z.array(designSystemSummarySchema);

async function newTeam(name: string): Promise<string> {
  return (
    (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
      id: string;
    }
  ).id;
}

async function member(role: 'org_owner' | 'designer' | 'viewer', team: string): Promise<SignedIn> {
  const who = await signIn(app, newIdentity(`Studio ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

async function newProject(who: SignedIn, name: string): Promise<string> {
  return projectSchema.parse(
    (await mutate(app, 'post', '/api/v1/projects', who).send({ name }).expect(201)).body,
  ).id;
}

const agentOf = async (who: SignedIn, key: string) => {
  const found = agents
    .parse((await get('/api/v1/studio/agents', who).expect(200)).body)
    .find((a) => a.key === key);
  if (!found) throw new Error(`agent ${key} missing`);
  return found;
};

/** Reads the whole SSE stream of a run (the server ends it after the `done` event). */
async function runEvents(who: SignedIn, project: string, runId: string): Promise<RunEvent[]> {
  const res = await get(`/api/v1/projects/${project}/runs/${runId}/events`, who)
    .buffer(true)
    .parse((response, callback) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        text += chunk;
      });
      response.on('end', () => {
        callback(null, text);
      });
    })
    .expect(200);
  expect(res.headers['content-type']).toContain('text/event-stream');
  return (res.body as string)
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => runEventSchema.parse(JSON.parse(line.slice(6))));
}

async function waitForRun(who: SignedIn, project: string, runId: string): Promise<Run> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const run = runSchema.parse(
      (await get(`/api/v1/projects/${project}/runs/${runId}`, who).expect(200)).body,
    );
    if (run.status !== 'running') return run;
    if (Date.now() > deadline) throw new Error('run did not finish');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function startRun(who: SignedIn, project: string, prompt: string): Promise<string> {
  return (
    (
      await mutate(app, 'post', `/api/v1/projects/${project}/runs`, who)
        .send({ prompt })
        .expect(202)
    ).body as { id: string }
  ).id;
}

const screensOf = async (who: SignedIn, project: string) =>
  screensResponseSchema.parse(
    (await get(`/api/v1/projects/${project}/screens`, who).expect(200)).body,
  );

beforeAll(async () => {
  provider = await startFakeDesignOllama(SECRET);
  runtime = await startRuntime({
    localKek: TEST_LOCAL_KEK,
    issuer: requireEnv('TEST_OIDC_ISSUER_URL'),
    audience: TOKEN_SCOPE,
    allowedCaller: CLIENT_ID,
  });
  ({ app } = await createTestApp({
    AI_RUNTIME_URL: runtime.url,
    AI_RUNTIME_TOKEN_SCOPE: TOKEN_SCOPE,
    DESIGN_RUN_TIMEOUT_SECONDS: '60',
  }));
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  const suffix = String(Date.now());
  teamA = await newTeam(`Studio A ${suffix}`);
  teamB = await newTeam(`Studio B ${suffix}`);
  owner = await member('org_owner', teamA);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
  projectId = await newProject(designer, 'Studio journey');
  outsiderProjectId = await newProject(outsider, 'Other team');
}, 120_000);

afterAll(async () => {
  await app.close();
  await runtime.stop();
  await provider.close();
  await pool.end();
});

describe('studio config', () => {
  it('returns the preview origin to signed-in members only', async () => {
    expect(
      studioConfigSchema.parse((await get('/api/v1/studio/config', viewer).expect(200)).body),
    ).toEqual({ previewOrigin: 'http://127.0.0.1:8090', langsmithEnabled: false });
    await request(server()).get('/api/v1/studio/config').expect(401);
  });
});

describe('agents (AGENT.md) are versioned per team', () => {
  it('starts from the shipped defaults', async () => {
    const list = agents.parse((await get('/api/v1/studio/agents', viewer).expect(200)).body);
    expect(list.map((a) => a.key)).toEqual(['orchestrator', 'ux', 'ui', 'reviewer']);
    for (const a of list) {
      expect(a).toMatchObject({ version: 0, customized: false, enabled: true, model: null });
      expect(a.instructions.length).toBeGreaterThan(20);
    }
  });

  it('saves a new version, refuses a stale one and keeps history', async () => {
    const before = await agentOf(designer, 'ui');
    const updated = agentDefinitionSchema.parse(
      (
        await mutate(app, 'put', '/api/v1/studio/agents/ui', designer)
          .send({
            instructions: `${before.instructions}\n\nPrefer generous spacing.`,
            model: null,
            enabled: true,
            expectedVersion: 0,
          })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({ version: 1, customized: true });
    expect(updated.instructions).toContain('Prefer generous spacing.');
    expect(updated.updatedByName).toBe('Studio designer');

    const stale = await mutate(app, 'put', '/api/v1/studio/agents/ui', owner)
      .send({ instructions: before.instructions, model: null, enabled: true, expectedVersion: 0 })
      .expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_VERSION' } });

    const versions = z
      .array(agentVersionSchema)
      .parse((await get('/api/v1/studio/agents/ui/versions', viewer).expect(200)).body);
    expect(versions.map((v) => v.version)).toEqual([1]);
  });

  it('reverts by writing a new version (to an old one or the shipped default)', async () => {
    const shipped = (await agentOf(outsider, 'ui')).instructions;
    const reverted = agentDefinitionSchema.parse(
      (
        await mutate(app, 'post', '/api/v1/studio/agents/ui/revert', designer)
          .send({ toVersion: 0, expectedVersion: 1 })
          .expect(200)
      ).body,
    );
    expect(reverted).toMatchObject({ version: 2, instructions: shipped });
    const again = agentDefinitionSchema.parse(
      (
        await mutate(app, 'post', '/api/v1/studio/agents/ui/revert', designer)
          .send({ toVersion: 1, expectedVersion: 2 })
          .expect(200)
      ).body,
    );
    expect(again.version).toBe(3);
    expect(again.instructions).toContain('Prefer generous spacing.');
    await mutate(app, 'post', '/api/v1/studio/agents/ui/revert', designer)
      .send({ toVersion: 99, expectedVersion: 3 })
      .expect(404);
    await mutate(app, 'post', '/api/v1/studio/agents/ui/revert', designer)
      .send({ toVersion: 0, expectedVersion: 1 })
      .expect(409);
  });

  it('refuses to turn off the UI designer and the orchestrator', async () => {
    for (const key of ['ui', 'orchestrator'] as const) {
      const current = await agentOf(owner, key);
      const res = await mutate(app, 'put', `/api/v1/studio/agents/${key}`, owner)
        .send({
          instructions: current.instructions,
          model: null,
          enabled: false,
          expectedVersion: current.version,
        })
        .expect(409);
      expect(res.body).toMatchObject({ error: { code: 'AGENT_REQUIRED' } });
    }
  });

  it('validates input, requires write permission and CSRF', async () => {
    await mutate(app, 'put', '/api/v1/studio/agents/ui', designer)
      .send({ instructions: 'short', model: null, enabled: true, expectedVersion: 3 })
      .expect(400);
    await mutate(app, 'put', '/api/v1/studio/agents/ui', designer)
      .send({
        instructions: 'x'.repeat(40),
        model: 'bad model; drop',
        enabled: true,
        expectedVersion: 3,
      })
      .expect(400);
    await mutate(app, 'put', '/api/v1/studio/agents/not-an-agent', designer)
      .send({ instructions: 'x'.repeat(40), model: null, enabled: true, expectedVersion: 0 })
      .expect(400);
    await mutate(app, 'put', '/api/v1/studio/agents/ux', viewer)
      .send({ instructions: 'x'.repeat(40), model: null, enabled: true, expectedVersion: 0 })
      .expect(403);
    await request(server())
      .put('/api/v1/studio/agents/ux')
      .set('Cookie', designer.cookie)
      .set('Origin', 'http://studio.test')
      .send({ instructions: 'x'.repeat(40), model: null, enabled: true, expectedVersion: 0 })
      .expect(403);
  });

  it('is isolated per team', async () => {
    expect(await agentOf(outsider, 'ui')).toMatchObject({ version: 0, customized: false });
    expect(
      z
        .array(agentVersionSchema)
        .parse((await get('/api/v1/studio/agents/ui/versions', outsider).expect(200)).body),
    ).toEqual([]);
  });
});

describe('design systems (DESIGN.md + tokens.css)', () => {
  const TOKENS = [
    '--color-primary: #0b5cff;',
    '--color-primary-hover: #0848c7;',
    '--color-on-primary: #ffffff;',
    '--color-surface: #ffffff;',
    '--color-surface-2: #f4f6fa;',
    '--color-text: #101828;',
    '--color-text-muted: #475467;',
    '--color-border: #d0d5dd;',
    '--color-success: #079455;',
    '--color-warning: #dc6803;',
    '--color-danger: #d92d20;',
    '--color-info: #1570ef;',
    '--font-sans: Inter, sans-serif;',
    '--radius-sm: 4px;',
    '--radius-md: 8px;',
    '--radius-lg: 12px;',
    '--shadow-1: 0 1px 2px rgb(16 24 40 / 0.06);',
    '--focus-ring: 0 0 0 3px rgb(11 92 255 / 0.4);',
  ];
  const tokensCss = `:root {\n  ${TOKENS.join('\n  ')}\n}\n`;

  it('lists the shipped systems with CORE 2.0 first', async () => {
    const list = systems.parse(
      (await get('/api/v1/studio/design-systems', viewer).expect(200)).body,
    );
    expect(list.map((s) => s.slug)).toEqual(
      expect.arrayContaining(['core-2', 'corporate', 'flat', 'minimal']),
    );
    expect(list[0]).toMatchObject({ slug: 'core-2', version: 0, custom: false });
    const core = designSystemSchema.parse(
      (await get('/api/v1/studio/design-systems/core-2', viewer).expect(200)).body,
    );
    expect(core.designMd.length).toBeGreaterThan(100);
    await get('/api/v1/studio/design-systems/does-not-exist', viewer).expect(404);
  });

  it('creates a team system, refuses missing tokens, duplicates and stale saves', async () => {
    const shippedTokens = designSystemSchema.parse(
      (await get('/api/v1/studio/design-systems/core-2', designer).expect(200)).body,
    ).tokensCss;
    const body = {
      slug: 'acme',
      name: 'Acme',
      designMd: '# Acme\n\nFriendly, dense, blue primary actions.',
      tokensCss: shippedTokens,
    };
    const bad = await mutate(app, 'post', '/api/v1/studio/design-systems', designer)
      .send({ ...body, tokensCss: ':root { --color-primary: red; }' })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain('--color-surface');
    const created = designSystemSchema.parse(
      (await mutate(app, 'post', '/api/v1/studio/design-systems', designer).send(body).expect(201))
        .body,
    );
    expect(created).toMatchObject({ slug: 'acme', version: 1, custom: true });
    const dup = await mutate(app, 'post', '/api/v1/studio/design-systems', designer)
      .send({ ...body, slug: 'core-2' })
      .expect(409);
    expect(dup.body).toMatchObject({ error: { code: 'SLUG_TAKEN' } });

    const updated = designSystemSchema.parse(
      (
        await mutate(app, 'put', '/api/v1/studio/design-systems/acme', owner)
          .send({ name: 'Acme v2', designMd: body.designMd, tokensCss, expectedVersion: 1 })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({ version: 2, name: 'Acme v2' });
    const stale = await mutate(app, 'put', '/api/v1/studio/design-systems/acme', designer)
      .send({ name: 'Acme', designMd: body.designMd, tokensCss, expectedVersion: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_VERSION' } });
    expect(
      z
        .array(z.object({ version: z.number() }))
        .parse((await get('/api/v1/studio/design-systems/acme/versions', viewer).expect(200)).body)
        .map((v) => v.version),
    ).toEqual([2, 1]);
  });

  it('customizes a shipped system without losing its identity', async () => {
    const core = designSystemSchema.parse(
      (await get('/api/v1/studio/design-systems/core-2', owner).expect(200)).body,
    );
    const saved = designSystemSchema.parse(
      (
        await mutate(app, 'put', '/api/v1/studio/design-systems/core-2', owner)
          .send({
            name: core.name,
            designMd: `${core.designMd}\n\nTeam note.`,
            tokensCss: core.tokensCss,
            expectedVersion: 0,
          })
          .expect(200)
      ).body,
    );
    expect(saved).toMatchObject({ slug: 'core-2', version: 1, custom: false, customized: true });
  });

  it('is isolated per team', async () => {
    const theirs = systems.parse(
      (await get('/api/v1/studio/design-systems', outsider).expect(200)).body,
    );
    expect(theirs.some((s) => s.slug === 'acme')).toBe(false);
    expect(theirs.find((s) => s.slug === 'core-2')).toMatchObject({ customized: false });
    await get('/api/v1/studio/design-systems/acme', outsider).expect(404);
    await mutate(app, 'post', '/api/v1/studio/design-systems', viewer)
      .send({ slug: 'nope', name: 'Nope', designMd: 'x'.repeat(30), tokensCss })
      .expect(403);
  });
});

describe('project design', () => {
  it('starts with CORE 2.0 and applies a team system into the project repository', async () => {
    const initial = projectDesignSchema.parse(
      (await get(`/api/v1/projects/${projectId}/design`, viewer).expect(200)).body,
    );
    expect(initial.designSystemSlug).toBe('core-2');
    const applied = projectDesignSchema.parse(
      (
        await mutate(app, 'post', `/api/v1/projects/${projectId}/design/apply`, designer)
          .send({ slug: 'acme' })
          .expect(200)
      ).body,
    );
    expect(applied).toMatchObject({ designSystemSlug: 'acme' });
    expect(applied.designMd).toContain('# Acme');
    expect(applied.tokensCss).toContain('--color-primary: #0b5cff');
    expect(applied.revision).toBeGreaterThan(initial.revision);
    await mutate(app, 'post', `/api/v1/projects/${projectId}/design/apply`, designer)
      .send({ slug: 'missing' })
      .expect(404);
  });

  it('edits DESIGN.md with optimistic concurrency', async () => {
    const current = projectDesignSchema.parse(
      (await get(`/api/v1/projects/${projectId}/design`, designer).expect(200)).body,
    );
    const saved = projectDesignSchema.parse(
      (
        await mutate(app, 'put', `/api/v1/projects/${projectId}/design`, designer)
          .send({
            designMd: `${current.designMd}\n\nProject rule: rounded cards.`,
            tokensCss: current.tokensCss,
            baseRevision: current.revision,
          })
          .expect(200)
      ).body,
    );
    expect(saved.designMd).toContain('Project rule: rounded cards.');
    const stale = await mutate(app, 'put', `/api/v1/projects/${projectId}/design`, owner)
      .send({
        designMd: current.designMd,
        tokensCss: current.tokensCss,
        baseRevision: current.revision,
      })
      .expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_REVISION' } });
  });

  it('is invisible to other teams and read-only for viewers', async () => {
    await get(`/api/v1/projects/${projectId}/design`, outsider).expect(404);
    await get(`/api/v1/projects/${projectId}/screens`, outsider).expect(404);
    await mutate(app, 'post', `/api/v1/projects/${projectId}/design/apply`, viewer)
      .send({ slug: 'core-2' })
      .expect(403);
    await mutate(app, 'post', `/api/v1/projects/${projectId}/design/apply`, outsider)
      .send({ slug: 'core-2' })
      .expect(404);
  });
});

describe('design runs', () => {
  it('need a team default model', async () => {
    const res = await mutate(app, 'post', `/api/v1/projects/${outsiderProjectId}/runs`, outsider)
      .send({ prompt: 'A sign-in screen' })
      .expect(409);
    expect(res.body).toMatchObject({ error: { code: 'NO_DEFAULT_MODEL' } });
  });

  it('configure the team key and default model', async () => {
    await stepUp(app, owner);
    const credential = credentialSummarySchema.parse(
      (
        await mutate(app, 'post', '/api/v1/llm/credentials', owner)
          .send({
            scope: 'organization',
            provider: 'ollama',
            label: 'Studio Ollama',
            endpoint: provider.url,
            secret: SECRET,
          })
          .expect(201)
      ).body,
    ).id;
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: credential, model: 'llama3.2:3b' })
      .expect(204);
    // A per-agent model override for the reviewer.
    const reviewer = await agentOf(owner, 'reviewer');
    await mutate(app, 'put', '/api/v1/studio/agents/reviewer', owner)
      .send({
        instructions: reviewer.instructions,
        model: 'qwen2.5:7b',
        enabled: true,
        expectedVersion: reviewer.version,
      })
      .expect(200);
  });

  it('run end to end through the real runtime and save screens with a checkpoint', async () => {
    provider.calls.length = 0;
    provider.models.length = 0;
    const runId = await startRun(designer, projectId, 'A sign-in screen and a dashboard');
    const events = await runEvents(viewer, projectId, runId);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('step_started');
    expect(types).toEqual(expect.arrayContaining(['plan', 'screen', 'review', 'saved']));
    expect(types.at(-1)).toBe('done');
    expect(events.at(-1)).toEqual({ type: 'done', status: 'succeeded', errorCode: null });
    const plan = events.find((e) => e.type === 'plan');
    expect(plan).toMatchObject({
      title: 'Account area',
      screens: [
        { name: 'Sign in', route: '/' },
        { name: 'Dashboard', route: '/dashboard' },
      ],
    });
    // Screen code is never relayed to the browser over SSE (the studio reads it from the repository).
    for (const e of events.filter((x) => x.type === 'screen')) expect(e).not.toHaveProperty('code');
    expect(JSON.stringify(events)).not.toContain(SECRET);

    expect(provider.calls).toEqual(['plan', 'ux', 'ui', 'ui', 'review']);
    expect(provider.models.find((m) => m.role === 'plan')?.model).toBe('llama3.2:3b');
    expect(provider.models.find((m) => m.role === 'review')?.model).toBe('qwen2.5:7b');
    expect(provider.seenAuthorization.every((h) => h === `Bearer ${SECRET}`)).toBe(true);

    const run = await waitForRun(viewer, projectId, runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      title: 'Account area',
      screens: 2,
      reviewScore: 92,
      inputTokens: 500,
      outputTokens: 250,
      errorCode: null,
      startedByName: 'Studio designer',
      traced: false,
    });
    expect(run.steps.map((s) => s.agent)).toEqual(['orchestrator', 'ux', 'ui', 'ui', 'reviewer']);
    expect(run.steps.every((s) => s.status === 'succeeded' && s.inputTokens === 100)).toBe(true);

    const screens = await screensOf(viewer, projectId);
    const routes = screens.screens.map((s) => s.route);
    expect(routes).toEqual(expect.arrayContaining(['/', '/dashboard']));
    const dashboard = screens.screens.find((s) => s.route === '/dashboard');
    expect(dashboard?.code).toBe(fakeScreenCode('Dashboard', '/'));
    expect(screens.tokensCss).toContain('--color-primary: #0b5cff');

    const listed = z
      .array(runSchema)
      .parse((await get(`/api/v1/projects/${projectId}/runs`, viewer).expect(200)).body);
    expect(listed[0]?.id).toBe(runId);

    const checkpoints = z
      .array(z.object({ message: z.string() }))
      .parse((await get(`/api/v1/projects/${projectId}/checkpoints`, viewer).expect(200)).body);
    expect(checkpoints.some((c) => c.message === 'AI: Account area')).toBe(true);
  });

  it('resume the event stream after a dropped connection instead of replaying it', async () => {
    const [latest] = z
      .array(runSchema)
      .parse((await get(`/api/v1/projects/${projectId}/runs`, viewer).expect(200)).body);
    if (!latest) throw new Error('no runs');
    const readRaw = async (lastEventId?: string) => {
      let req = get(`/api/v1/projects/${projectId}/runs/${latest.id}/events`, viewer);
      if (lastEventId) req = req.set('Last-Event-ID', lastEventId);
      const res = await req
        .buffer(true)
        .parse((response, callback) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () => {
            callback(null, text);
          });
        })
        .expect(200);
      return (res.body as string)
        .split('\n\n')
        .filter((block) => block.startsWith('id: '))
        .map((block) => {
          const [idLine, dataLine] = block.split('\n');
          return {
            id: idLine?.slice(4) ?? '',
            event: runEventSchema.parse(JSON.parse(dataLine?.slice(6) ?? '{}')),
          };
        });
    };
    const all = await readRaw();
    const savedIndex = all.findIndex((e) => e.event.type === 'saved');
    expect(savedIndex).toBeGreaterThan(0);
    const resumed = await readRaw(all[savedIndex]?.id);
    expect(resumed.map((e) => e.event.type)).toEqual(['done']);
    // A malformed header is ignored (full replay), never passed to Redis.
    expect(await readRaw('0-0; DROP')).toHaveLength(all.length);
  });

  it('send failing screens back to the UI designer for one fix round', async () => {
    provider.calls.length = 0;
    provider.set({ passFirstReview: false });
    const runId = await startRun(designer, projectId, 'Make it more on-brand');
    const events = await runEvents(designer, projectId, runId);
    expect(events.filter((e) => e.type === 'review').map((e) => e.round)).toEqual([0, 1]);
    expect(provider.calls).toEqual(['plan', 'ux', 'ui', 'ui', 'review', 'ui', 'ui', 'review']);
    // The fake returns the same screens as the last run: no new checkpoint, but still a success.
    expect(events.find((e) => e.type === 'saved')).toMatchObject({ checkpointId: null });
    expect(await waitForRun(designer, projectId, runId)).toMatchObject({
      status: 'succeeded',
      reviewScore: 92,
    });
    provider.set({ passFirstReview: true });
  });

  it('skip a disabled optional agent', async () => {
    const ux = await agentOf(owner, 'ux');
    await mutate(app, 'put', '/api/v1/studio/agents/ux', owner)
      .send({ instructions: ux.instructions, model: null, enabled: false, expectedVersion: 0 })
      .expect(200);
    provider.calls.length = 0;
    const runId = await startRun(designer, projectId, 'Same again without UX');
    await runEvents(designer, projectId, runId);
    expect(provider.calls).toEqual(['plan', 'ui', 'ui', 'review']);
    await mutate(app, 'post', '/api/v1/studio/agents/ux/revert', owner)
      .send({ toVersion: 0, expectedVersion: 1 })
      .expect(200);
  });

  it('refuse to save screens that are not valid TSX', async () => {
    const before = await screensOf(designer, projectId);
    provider.set({ invalidUi: true });
    const runId = await startRun(designer, projectId, 'Break the code');
    const events = await runEvents(designer, projectId, runId);
    expect(events.at(-1)).toEqual({
      type: 'done',
      status: 'failed',
      errorCode: 'invalid_screens',
    });
    provider.set({ invalidUi: false });
    const after = await screensOf(designer, projectId);
    expect(after.revision).toBe(before.revision);
    expect(after.screens.map((s) => s.code)).toEqual(before.screens.map((s) => s.code));
  });

  it('report provider failures with a fixed code and never relay upstream detail', async () => {
    provider.set({ status: 500 });
    const runId = await startRun(designer, projectId, 'Provider is down');
    const events = await runEvents(designer, projectId, runId);
    provider.set({ status: 200 });
    expect(events.some((e) => e.type === 'step_failed' && e.agent === 'orchestrator')).toBe(true);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', status: 'failed' });
    expect(JSON.stringify(events)).not.toContain('upstream-detail-must-not-leak');
    const run = await waitForRun(designer, projectId, runId);
    expect(run.status).toBe('failed');
    expect(run.errorCode).not.toBeNull();
    expect(run.steps[0]).toMatchObject({ agent: 'orchestrator', status: 'failed' });
  });

  it('allow one run at a time per project', async () => {
    provider.set({ delayMs: 1500 });
    const runId = await startRun(designer, projectId, 'Slow run');
    const second = await mutate(app, 'post', `/api/v1/projects/${projectId}/runs`, owner)
      .send({ prompt: 'Parallel run' })
      .expect(409);
    expect(second.body).toMatchObject({ error: { code: 'RUN_IN_PROGRESS' } });
    await runEvents(designer, projectId, runId);
    provider.set({ delayMs: 0 });
    expect((await waitForRun(designer, projectId, runId)).status).toBe('succeeded');
  });

  it('enforce permissions, validation and team isolation', async () => {
    await mutate(app, 'post', `/api/v1/projects/${projectId}/runs`, viewer)
      .send({ prompt: 'Viewer run' })
      .expect(403);
    await mutate(app, 'post', `/api/v1/projects/${projectId}/runs`, designer)
      .send({ prompt: 'x' })
      .expect(400);
    await mutate(app, 'post', `/api/v1/projects/${projectId}/runs`, outsider)
      .send({ prompt: 'Cross-team run' })
      .expect(404);
    const [latest] = z
      .array(runSchema)
      .parse((await get(`/api/v1/projects/${projectId}/runs`, designer).expect(200)).body);
    if (!latest) throw new Error('no runs');
    await get(`/api/v1/projects/${projectId}/runs/${latest.id}`, outsider).expect(404);
    await get(`/api/v1/projects/${projectId}/runs/${latest.id}/events`, outsider).expect(404);
    await get(`/api/v1/projects/${outsiderProjectId}/runs/${latest.id}`, outsider).expect(404);
    expect(
      (await get(`/api/v1/projects/${outsiderProjectId}/runs`, outsider).expect(200)).body,
    ).toEqual([]);

    // Row-level security, below the API: team B's database context sees none of team A's runs.
    const db = createDatabase(pool);
    const asOutsider = await withDbContext(
      db,
      { organizationId: teamB, userId: outsider.session.user.id },
      async (tx) => ({
        runs: await tx.select().from(generationRuns).where(eq(generationRuns.id, latest.id)),
        steps: await tx.select().from(runSteps).where(eq(runSteps.runId, latest.id)),
      }),
    );
    expect(asOutsider).toEqual({ runs: [], steps: [] });
    const asMember = await withDbContext(
      db,
      { organizationId: teamA, userId: designer.session.user.id },
      (tx) => tx.select().from(generationRuns).where(eq(generationRuns.id, latest.id)),
    );
    expect(asMember).toHaveLength(1);
  });
});

describe('canvas source edits', () => {
  const locate = (code: string, needle: string) => {
    const lines = code.split('\n');
    const index = lines.findIndex((l) => l.includes(needle));
    if (index < 0) throw new Error(`${needle} not found`);
    return { line: index + 1, column: lines[index]?.indexOf(needle) ?? 0 };
  };
  const dashboard = async () => {
    const all = await screensOf(designer, projectId);
    const screen = all.screens.find((s) => s.route === '/dashboard');
    if (!screen) throw new Error('dashboard missing');
    return { revision: all.revision, screen };
  };
  const edit = (who: SignedIn, body: Record<string, unknown>) =>
    mutate(app, 'post', `/api/v1/projects/${projectId}/source-edits`, who).send(body);

  it('change text, classes and attributes precisely in the source', async () => {
    let { revision, screen } = await dashboard();
    const h1 = locate(screen.code, '<h1');
    let res = sourceEditResultSchema.parse(
      (
        await edit(designer, {
          path: screen.filePath,
          ...h1,
          baseRevision: revision,
          op: { type: 'setText', text: 'Your accounts' },
        }).expect(200)
      ).body,
    );
    expect(res.code).toContain('>Your accounts</h1>');
    expect(res.revision).toBe(revision + 1);
    // Everything else keeps its exact formatting.
    expect(res.code.replace('Your accounts', 'Dashboard')).toBe(screen.code);

    res = sourceEditResultSchema.parse(
      (
        await edit(designer, {
          path: screen.filePath,
          ...h1,
          baseRevision: res.revision,
          op: { type: 'setClassName', className: 'text-3xl font-semibold' },
        }).expect(200)
      ).body,
    );
    expect(res.code).toContain('<h1 className="text-3xl font-semibold">Your accounts</h1>');

    const button = locate(res.code, '<button');
    res = sourceEditResultSchema.parse(
      (
        await edit(designer, {
          path: screen.filePath,
          ...button,
          baseRevision: res.revision,
          op: { type: 'setAttribute', name: 'aria-label', value: 'Continue to sign in' },
        }).expect(200)
      ).body,
    );
    expect(res.code).toContain('aria-label="Continue to sign in"');
    ({ revision, screen } = await dashboard());
    expect(revision).toBe(res.revision);
    expect(screen.code).toBe(res.code);
  });

  it('refuse stale, ambiguous and unsafe edits', async () => {
    const { revision, screen } = await dashboard();
    const h1 = locate(screen.code, '<h1');
    const stale = await edit(designer, {
      path: screen.filePath,
      ...h1,
      baseRevision: revision - 1,
      op: { type: 'setText', text: 'Old' },
    }).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_REVISION' } });

    const missing = await edit(designer, {
      path: screen.filePath,
      line: 1,
      column: 0,
      baseRevision: revision,
      op: { type: 'setText', text: 'x' },
    }).expect(409);
    expect(missing.body).toMatchObject({ error: { code: 'EDIT_ELEMENT_NOT_FOUND' } });

    const nested = await edit(designer, {
      path: screen.filePath,
      ...locate(screen.code, '<main'),
      baseRevision: revision,
      op: { type: 'setText', text: 'Flatten everything' },
    }).expect(409);
    expect(nested.body).toMatchObject({ error: { code: 'EDIT_UNSUPPORTED' } });

    await edit(designer, {
      path: screen.filePath,
      ...h1,
      baseRevision: revision,
      op: { type: 'setClassName', className: 'x" onClick={alert(1)}' },
    }).expect(400);
    await edit(designer, {
      path: screen.filePath,
      ...h1,
      baseRevision: revision,
      op: { type: 'setAttribute', name: 'onClick', value: 'alert(1)' },
    }).expect(400);
    // Text with JSX-significant characters is stored as a string literal, never as markup.
    const literal = sourceEditResultSchema.parse(
      (
        await edit(designer, {
          path: screen.filePath,
          ...h1,
          baseRevision: revision,
          op: { type: 'setText', text: '<script>{x}</script>' },
        }).expect(200)
      ).body,
    );
    expect(literal.code).toContain('{"<script>{x}</script>"}</h1>');

    await edit(designer, {
      path: 'src/main.tsx',
      ...h1,
      baseRevision: literal.revision,
      op: { type: 'setText', text: 'x' },
    }).expect(400);
    await edit(designer, {
      path: '../../etc/passwd',
      ...h1,
      baseRevision: literal.revision,
      op: { type: 'setText', text: 'x' },
    }).expect(400);
    await edit(viewer, {
      path: screen.filePath,
      ...h1,
      baseRevision: literal.revision,
      op: { type: 'setText', text: 'x' },
    }).expect(403);
    await mutate(app, 'post', `/api/v1/projects/${projectId}/source-edits`, outsider)
      .send({
        path: screen.filePath,
        ...h1,
        baseRevision: literal.revision,
        op: { type: 'setText', text: 'x' },
      })
      .expect(404);
  });
});

describe('metrics', () => {
  it('summarise runs, agents and models for the team only', async () => {
    const metrics = metricsSchema.parse(
      (await get('/api/v1/studio/metrics?days=7', viewer).expect(200)).body,
    );
    expect(metrics.days).toBe(7);
    expect(metrics.totals.runs).toBe(6);
    expect(metrics.totals.succeeded).toBe(4);
    expect(metrics.totals.failed).toBe(2);
    expect(metrics.byAgent.map((a) => a.agent)).toEqual(
      expect.arrayContaining(['orchestrator', 'ux', 'ui', 'reviewer']),
    );
    expect(metrics.byModel.map((m) => m.model)).toEqual(
      expect.arrayContaining(['llama3.2:3b', 'qwen2.5:7b']),
    );
    expect(metrics.byProject).toEqual([
      expect.objectContaining({ projectId, name: 'Studio journey', runs: 6 }),
    ]);
    expect(metrics.errors.map((e) => e.code)).toContain('invalid_screens');

    const theirs = metricsSchema.parse(
      (await get('/api/v1/studio/metrics', outsider).expect(200)).body,
    );
    expect(theirs.totals.runs).toBe(0);
    expect(theirs.byProject).toEqual([]);
    await get('/api/v1/studio/metrics?days=0', viewer).expect(400);
  });
});

describe('archived projects', () => {
  it('are read-only in the studio', async () => {
    const project = projectSchema.parse(
      (await get(`/api/v1/projects/${projectId}`, designer).expect(200)).body,
    );
    await mutate(app, 'patch', `/api/v1/projects/${projectId}`, designer)
      .send({ status: 'archived', expectedUpdatedAt: project.updatedAt })
      .expect(200);
    for (const res of [
      await mutate(app, 'post', `/api/v1/projects/${projectId}/runs`, designer).send({
        prompt: 'After archive',
      }),
      await mutate(app, 'post', `/api/v1/projects/${projectId}/design/apply`, designer).send({
        slug: 'core-2',
      }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'PROJECT_ARCHIVED' } });
    }
    expect((await screensOf(viewer, projectId)).screens.length).toBeGreaterThan(0);
  });
});
