import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  agentDefinitionSchema,
  agentTestResultSchema,
  credentialSummarySchema,
  designSystemSchema,
  designSystemSummarySchema,
  type KnowledgeDocument,
  knowledgeDocumentSchema,
  projectSchema,
  runSchema,
  type Run,
} from '@core-studio/contracts';
import { and, eq, like } from 'drizzle-orm';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { auditEvents, generationRuns, knowledgeDocuments } from '../../src/db/schema.js';
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
  type RealRuntime,
  startFakeDesignOllama,
  startRuntime,
} from './support/runtime.js';

const SECRET = 'ollama-TEST-knowledge-0000000000';
const TOKEN_SCOPE = 'api://core-ai-runtime/.default';
const CLIENT_ID = 'core-studio-test';
const KNOWLEDGE_URL = '/api/v1/studio/knowledge';

let app: NestExpressApplication;
let runtime: RealRuntime;
let provider: FakeDesignProvider;
let pool: Pool;
let admin: SignedIn;
let owner: SignedIn;
let teamAdmin: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let teamB: string;
let projectId: string;

const server = () => app.getHttpServer();
const get = (path: string, who: SignedIn) => request(server()).get(path).set('Cookie', who.cookie);
const docs = z.array(knowledgeDocumentSchema);
const listOf = async (who: SignedIn) =>
  docs.parse((await get(KNOWLEDGE_URL, who).expect(200)).body);

async function newTeam(name: string): Promise<string> {
  return (
    (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
      id: string;
    }
  ).id;
}

async function member(
  role: 'org_owner' | 'org_admin' | 'designer' | 'viewer',
  team: string,
): Promise<SignedIn> {
  const who = await signIn(app, newIdentity(`Knowledge ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

async function createDoc(
  who: SignedIn,
  body: { title: string; body: string; enabled?: boolean },
): Promise<KnowledgeDocument> {
  return knowledgeDocumentSchema.parse(
    (await mutate(app, 'post', KNOWLEDGE_URL, who).send(body).expect(201)).body,
  );
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

const testAgent = (who: SignedIn, key: string, body: Record<string, unknown>) =>
  mutate(app, 'post', `/api/v1/studio/agents/${key}/test`, who).send(body);

const INSTRUCTIONS = 'You are the UI designer for the test. TEST-MARKER-INSTRUCTIONS.';

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
  teamA = await newTeam(`Knowledge A ${suffix}`);
  teamB = await newTeam(`Knowledge B ${suffix}`);
  owner = await member('org_owner', teamA);
  teamAdmin = await member('org_admin', teamA);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
  projectId = projectSchema.parse(
    (
      await mutate(app, 'post', '/api/v1/projects', designer)
        .send({ name: 'Knowledge journey' })
        .expect(201)
    ).body,
  ).id;
}, 120_000);

afterAll(async () => {
  await app.close();
  await runtime.stop();
  await provider.close();
  await pool.end();
});

describe('knowledge base', () => {
  let doc: KnowledgeDocument;

  it('starts empty and is readable by every member', async () => {
    expect(await listOf(viewer)).toEqual([]);
    expect(await listOf(designer)).toEqual([]);
  });

  it('is written by team admins and owners only', async () => {
    const body = { title: 'Tone', body: 'Say "member", never "user".' };
    await mutate(app, 'post', KNOWLEDGE_URL, designer).send(body).expect(403);
    await mutate(app, 'post', KNOWLEDGE_URL, viewer).send(body).expect(403);
    // CSRF is required like every other write.
    await request(server()).post(KNOWLEDGE_URL).set('Cookie', owner.cookie).send(body).expect(403);

    doc = await createDoc(owner, body);
    expect(doc).toMatchObject({
      title: 'Tone',
      body: 'Say "member", never "user".',
      enabled: true,
      createdByName: 'Knowledge org_owner',
      updatedByName: 'Knowledge org_owner',
    });
    const second = await createDoc(teamAdmin, { title: 'Draft', body: '', enabled: false });
    expect(second).toMatchObject({ enabled: false, body: '' });
    expect((await listOf(viewer)).map((d) => d.title)).toEqual(['Tone', 'Draft']);
  });

  it('validates input', async () => {
    const bad = (body: Record<string, unknown>) =>
      mutate(app, 'post', KNOWLEDGE_URL, owner).send(body).expect(400);
    await bad({ title: '   ', body: 'x' });
    await bad({ title: 'x'.repeat(121), body: 'x' });
    await bad({ title: 'Big', body: 'x'.repeat(100_001) });
    await mutate(app, 'put', `${KNOWLEDGE_URL}/${doc.id}`, owner)
      .send({ title: 'Tone', body: 'x', enabled: true })
      .expect(400);
    await mutate(app, 'put', `${KNOWLEDGE_URL}/not-a-uuid`, owner)
      .send({ title: 'Tone', body: 'x', enabled: true, expectedUpdatedAt: doc.updatedAt })
      .expect(400);
  });

  it('updates with optimistic concurrency', async () => {
    const res = await mutate(app, 'put', `${KNOWLEDGE_URL}/${doc.id}`, teamAdmin)
      .send({
        title: 'Tone of voice',
        body: 'Say "member". TEST-MARKER-ENABLED',
        enabled: true,
        expectedUpdatedAt: doc.updatedAt,
      })
      .expect(200);
    const updated = knowledgeDocumentSchema.parse(res.body);
    expect(updated).toMatchObject({
      title: 'Tone of voice',
      updatedByName: 'Knowledge org_admin',
      createdByName: 'Knowledge org_owner',
      createdAt: doc.createdAt,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(doc.updatedAt));

    // A second save from the same stale copy (even within the same millisecond) is refused.
    const stale = await mutate(app, 'put', `${KNOWLEDGE_URL}/${doc.id}`, owner)
      .send({ title: 'Mine', body: 'x', enabled: true, expectedUpdatedAt: doc.updatedAt })
      .expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_UPDATE' } });
    await mutate(app, 'put', `${KNOWLEDGE_URL}/${doc.id}`, designer)
      .send({ title: 'Mine', body: 'x', enabled: true, expectedUpdatedAt: updated.updatedAt })
      .expect(403);
    doc = updated;
  });

  it('deletes, and records every write in the audit log', async () => {
    const temp = await createDoc(owner, { title: 'Temporary', body: 'gone soon' });
    await mutate(app, 'delete', `${KNOWLEDGE_URL}/${temp.id}`, designer).expect(403);
    await mutate(app, 'delete', `${KNOWLEDGE_URL}/${temp.id}`, owner).expect(204);
    await mutate(app, 'delete', `${KNOWLEDGE_URL}/${temp.id}`, owner).expect(404);
    expect((await listOf(owner)).some((d) => d.id === temp.id)).toBe(false);

    const audit = await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: owner.session.user.id },
      (tx) =>
        tx
          .select({ action: auditEvents.action, targetId: auditEvents.targetId })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.targetType, 'knowledge_document'),
              like(auditEvents.action, 'knowledge.%'),
            ),
          ),
    );
    const actions = (id: string) => audit.filter((a) => a.targetId === id).map((a) => a.action);
    expect(actions(doc.id).sort()).toEqual(['knowledge.created', 'knowledge.updated']);
    expect(actions(temp.id).sort()).toEqual(['knowledge.created', 'knowledge.deleted']);
  });

  it('is isolated per team, in the API and in the database', async () => {
    expect(await listOf(outsider)).toEqual([]);
    await mutate(app, 'put', `${KNOWLEDGE_URL}/${doc.id}`, outsider)
      .send({ title: 'Hijack', body: 'x', enabled: true, expectedUpdatedAt: doc.updatedAt })
      .expect(404);
    await mutate(app, 'delete', `${KNOWLEDGE_URL}/${doc.id}`, outsider).expect(404);
    const asOutsider = await withDbContext(
      createDatabase(pool),
      { organizationId: teamB, userId: outsider.session.user.id },
      (tx) => tx.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id)),
    );
    expect(asOutsider).toEqual([]);
  });
});

describe('agents use the knowledge base', () => {
  it('need a default model to be tested', async () => {
    const res = await testAgent(outsider, 'ui', {
      instructions: INSTRUCTIONS,
      prompt: 'A sign-in screen',
    }).expect(409);
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
            label: 'Knowledge Ollama',
            endpoint: provider.url,
            secret: SECRET,
          })
          .expect(201)
      ).body,
    ).id;
    await mutate(app, 'put', '/api/v1/llm/default-model', owner)
      .send({ credentialId: credential, model: 'llama3.2:3b' })
      .expect(204);
    await createDoc(owner, { title: 'Hidden', body: 'TEST-MARKER-DISABLED', enabled: false });
  });

  it('receive enabled documents after DESIGN.md on every step of a run', async () => {
    provider.prompts.length = 0;
    const runId = (
      (
        await mutate(app, 'post', `/api/v1/projects/${projectId}/runs`, designer)
          .send({ prompt: 'A sign-in screen' })
          .expect(202)
      ).body as { id: string }
    ).id;
    expect((await waitForRun(designer, projectId, runId)).status).toBe('succeeded');
    expect(provider.prompts.map((p) => p.role)).toEqual(['plan', 'ux', 'ui', 'ui', 'review']);
    for (const { system } of provider.prompts) {
      expect(system).toContain('## Team knowledge');
      expect(system).toContain('### Tone of voice\n\nSay "member". TEST-MARKER-ENABLED');
      expect(system).not.toContain('TEST-MARKER-DISABLED');
      expect(system.indexOf('## tokens.css')).toBeLessThan(system.indexOf('## Team knowledge'));
      expect(system.indexOf('## Team knowledge')).toBeLessThan(system.indexOf('# Output contract'));
    }
    const [row] = await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: designer.session.user.id },
      (tx) =>
        tx
          .select({ knowledge: generationRuns.knowledge })
          .from(generationRuns)
          .where(eq(generationRuns.id, runId)),
    );
    expect(row?.knowledge).toEqual([
      { id: expect.any(String) as string, title: 'Tone of voice', truncated: false },
    ]);
  });
});

describe('test this agent', () => {
  const runsCount = async () =>
    z
      .array(runSchema)
      .parse((await get(`/api/v1/projects/${projectId}/runs`, designer).expect(200)).body).length;

  it('runs only that agent with the editor text, the default model, DESIGN.md and knowledge', async () => {
    const before = await runsCount();
    const ui = agentDefinitionSchema
      .array()
      .parse((await get('/api/v1/studio/agents', designer).expect(200)).body)
      .find((a) => a.key === 'ui');
    provider.prompts.length = 0;
    const res = await testAgent(designer, 'ui', {
      instructions: INSTRUCTIONS,
      prompt: 'A sign-in screen for members',
    }).expect(200);
    const result = agentTestResultSchema.parse(res.body);
    expect(result).toMatchObject({
      valid: true,
      model: 'llama3.2:3b',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.output).toContain('export default function MainScreen()');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(provider.seenAuthorization.at(-1)).toBe(`Bearer ${SECRET}`);

    expect(provider.prompts).toHaveLength(1);
    const [call] = provider.prompts;
    expect(call?.role).toBe('ui');
    expect(call?.system.startsWith(INSTRUCTIONS)).toBe(true);
    expect(call?.system).toContain('# Design system (DESIGN.md)\n# CORE 2.0');
    expect(call?.system).toContain('TEST-MARKER-ENABLED');
    expect(call?.user).toContain('User request:\nA sign-in screen for members');

    // Nothing saved: no run, and the agent's AGENT.md is unchanged.
    expect(await runsCount()).toBe(before);
    const after = agentDefinitionSchema
      .array()
      .parse((await get('/api/v1/studio/agents', designer).expect(200)).body)
      .find((a) => a.key === 'ui');
    expect(after).toEqual(ui);
  });

  it('uses the chosen design system and the agent model override', async () => {
    const systems = z
      .array(designSystemSummarySchema)
      .parse((await get('/api/v1/studio/design-systems', designer).expect(200)).body);
    const other = systems.find((s) => s.slug !== 'core-2');
    if (!other) throw new Error('no second design system');
    const full = designSystemSchema.parse(
      (await get(`/api/v1/studio/design-systems/${other.slug}`, designer).expect(200)).body,
    );
    const reviewer = agentDefinitionSchema
      .array()
      .parse((await get('/api/v1/studio/agents', owner).expect(200)).body)
      .find((a) => a.key === 'reviewer');
    if (!reviewer) throw new Error('no reviewer');
    await mutate(app, 'put', '/api/v1/studio/agents/reviewer', owner)
      .send({
        instructions: reviewer.instructions,
        model: 'qwen2.5:7b',
        enabled: true,
        expectedVersion: reviewer.version,
      })
      .expect(200);

    provider.prompts.length = 0;
    const res = await testAgent(designer, 'reviewer', {
      instructions: 'You review screens strictly against the design system.',
      prompt: 'Check this\n```tsx\nexport default function A() { return <main />; }\n```',
      designSystemSlug: other.slug,
    }).expect(200);
    const result = agentTestResultSchema.parse(res.body);
    expect(result.model).toBe('qwen2.5:7b');
    expect(result.valid).toBe(true);
    expect(JSON.parse(result.output)).toHaveProperty('screens');
    expect(provider.prompts[0]?.role).toBe('review');
    expect(provider.prompts[0]?.system).toContain(full.designMd.trim().slice(0, 60));
    expect(provider.prompts[0]?.user).toContain('export default function A()');

    await testAgent(designer, 'orchestrator', {
      instructions: 'You plan the screens for the request.',
      prompt: 'A loan application',
    }).expect(200);
    expect(provider.prompts[1]?.role).toBe('plan');
  });

  it('maps provider failures to fixed codes without relaying upstream detail', async () => {
    provider.set({ status: 500 });
    const failed = await testAgent(designer, 'ui', {
      instructions: INSTRUCTIONS,
      prompt: 'Provider is down',
    }).expect(424);
    provider.set({ status: 401 });
    const rejected = await testAgent(designer, 'ui', {
      instructions: INSTRUCTIONS,
      prompt: 'Key is wrong',
    }).expect(424);
    provider.set({ status: 200 });
    expect(failed.body).toMatchObject({ error: { code: 'AGENT_TEST_PROVIDER_ERROR' } });
    expect(rejected.body).toMatchObject({ error: { code: 'AGENT_TEST_UNAUTHORIZED' } });
    expect(JSON.stringify([failed.body, rejected.body])).not.toContain(
      'upstream-detail-must-not-leak',
    );
  });

  it('enforces permissions, validation and team isolation', async () => {
    const body = { instructions: INSTRUCTIONS, prompt: 'A sign-in screen' };
    await testAgent(viewer, 'ui', body).expect(403);
    await testAgent(designer, 'planner', body).expect(400);
    await testAgent(designer, 'ui', { ...body, instructions: 'short' }).expect(400);
    await testAgent(designer, 'ui', { ...body, prompt: 'x' }).expect(400);
    await testAgent(designer, 'ui', { ...body, designSystemSlug: 'Not A Slug' }).expect(400);
    await testAgent(designer, 'ui', { ...body, designSystemSlug: 'does-not-exist' }).expect(404);
    await request(server())
      .post('/api/v1/studio/agents/ui/test')
      .set('Cookie', designer.cookie)
      .send(body)
      .expect(403);
    // Team B has no default model of its own: team A's key is never used for it.
    await testAgent(outsider, 'ui', body).expect(409);
  });
});
