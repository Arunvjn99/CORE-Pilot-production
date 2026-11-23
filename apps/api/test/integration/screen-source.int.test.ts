import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  pageSchema,
  projectSchema,
  screenSourceResultSchema,
  screensResponseSchema,
} from '@core-studio/contracts';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { auditEvents } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

/** Writing a whole screen's source (undo/redo, code view). */
let app: NestExpressApplication;
let pool: pg.Pool;
let admin: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);

async function member(role: 'designer' | 'viewer' | 'org_owner', team: string) {
  const who = await signIn(app, newIdentity(`Source ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

const newFile = async (who: SignedIn, name: string) =>
  projectSchema.parse(
    (await mutate(app, 'post', '/api/v1/projects', who).send({ name }).expect(201)).body,
  );
const screensOf = async (who: SignedIn, id: string) =>
  screensResponseSchema.parse((await get(`/api/v1/projects/${id}/screens`, who).expect(200)).body);
const pagesOf = async (who: SignedIn, id: string) =>
  z.array(pageSchema).parse((await get(`/api/v1/projects/${id}/pages`, who).expect(200)).body);
const write = (who: SignedIn, id: string, pageId: string, body: Record<string, unknown>) =>
  mutate(app, 'put', `/api/v1/projects/${id}/screens/${pageId}/source`, who).send(body);

const screen = (title: string) =>
  `export default function Home() {\n  return <main className="p-8"><h1>${title}</h1></main>;\n}\n`;

beforeAll(async () => {
  ({ app } = await createTestApp());
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  admin = await signIn(app, { oid: ADMIN_OID, name: 'Company Admin' });
  const team = async (name: string) =>
    (
      (await mutate(app, 'post', '/api/v1/orgs', admin).send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
  teamA = await team(`Source A ${String(Date.now())}`);
  const teamB = await team(`Source B ${String(Date.now())}`);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
}, 60_000);

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('screen source', () => {
  it('replaces the code (undo/redo) and refuses stale revisions', async () => {
    const file = await newFile(designer, 'Source file');
    const before = await screensOf(designer, file.id);
    const home = before.screens[0];
    if (!home) throw new Error('home screen missing');

    const first = screenSourceResultSchema.parse(
      (
        await write(designer, file.id, home.pageId, {
          code: screen('Version 2'),
          baseRevision: before.revision,
        }).expect(200)
      ).body,
    );
    expect(first).toEqual({ revision: before.revision + 1, code: screen('Version 2') });
    const after = await screensOf(viewer, file.id);
    expect(after.revision).toBe(first.revision);
    expect(after.screens.find((s) => s.pageId === home.pageId)?.code).toBe(screen('Version 2'));

    // Undo: write the previous code back with the current revision.
    const undo = screenSourceResultSchema.parse(
      (
        await write(designer, file.id, home.pageId, {
          code: home.code,
          baseRevision: first.revision,
        }).expect(200)
      ).body,
    );
    expect(undo.revision).toBe(first.revision + 1);
    expect((await screensOf(viewer, file.id)).screens[0]?.code).toBe(home.code);

    // A client that still holds an old revision must reload.
    const stale = await write(designer, file.id, home.pageId, {
      code: screen('Lost update'),
      baseRevision: first.revision,
    }).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_REVISION' } });
    expect((await screensOf(viewer, file.id)).screens[0]?.code).toBe(home.code);

    const audit = await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: designer.session.user.id },
      (tx) =>
        tx
          .select({ action: auditEvents.action, metadata: auditEvents.metadata })
          .from(auditEvents)
          .where(
            and(eq(auditEvents.targetId, file.id), eq(auditEvents.action, 'screen.source_written')),
          ),
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]?.metadata).toMatchObject({ pageId: home.pageId });
  });

  it('refuses code that is not a valid screen', async () => {
    const file = await newFile(designer, 'Invalid source');
    const { revision, screens } = await screensOf(designer, file.id);
    const pageId = screens[0]?.pageId ?? '';
    for (const code of [
      'export default function Broken() { return <div>; }',
      'export function NoDefault() { return <div />; }',
      '',
    ]) {
      const res = await write(designer, file.id, pageId, { code, baseRevision: revision }).expect(
        400,
      );
      expect(res.body).toMatchObject({ error: { code: 'INVALID_SCREEN' } });
    }
    await write(designer, file.id, pageId, {
      code: `export default () => null;\n${'x'.repeat(200_001)}`,
      baseRevision: revision,
    }).expect(400);
    await write(designer, file.id, pageId, { code: screen('No revision') }).expect(400);
    expect((await screensOf(designer, file.id)).revision).toBe(revision);
    // Large screens up to the limit are fine.
    const big = `${screen('Big')}// ${'"quoted" '.repeat(19_000)}\n`;
    expect(big.length).toBeLessThanOrEqual(200_000);
    await write(designer, file.id, pageId, { code: big, baseRevision: revision }).expect(200);
  });

  it('only writes screens of this file, in the same team, for designers, outside Trash', async () => {
    const file = await newFile(designer, 'Guarded source');
    const other = await newFile(designer, 'Other source');
    const { revision, screens } = await screensOf(designer, file.id);
    const pageId = screens[0]?.pageId ?? '';
    const otherPage = (await pagesOf(designer, other.id))[0]?.id ?? '';
    const body = { code: screen('Nope'), baseRevision: revision };

    const wrongFile = await write(designer, file.id, otherPage, body).expect(404);
    expect(wrongFile.body).toMatchObject({ error: { code: 'PAGE_NOT_FOUND' } });
    await write(designer, file.id, crypto.randomUUID(), body).expect(404);
    await write(viewer, file.id, pageId, body).expect(403);
    await write(outsider, file.id, pageId, body).expect(404);

    await mutate(app, 'patch', `/api/v1/projects/${file.id}`, designer)
      .send({ status: 'archived', expectedUpdatedAt: file.updatedAt })
      .expect(200);
    const archived = await write(designer, file.id, pageId, body).expect(409);
    expect(archived.body).toMatchObject({ error: { code: 'PROJECT_ARCHIVED' } });
  });
});
