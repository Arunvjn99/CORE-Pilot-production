import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  checkpointSchema,
  folderSchema,
  pageSchema,
  type Project,
  projectSchema,
} from '@core-studio/contracts';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { projects as projectsTable } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

/** Figma-style hierarchy (ADR-0014): UI "Projects" are folders, UI "files" are projects. */
let app: NestExpressApplication;
let pool: pg.Pool;
let admin: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let teamB: string;

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
const files = z.array(projectSchema);
const foldersList = z.array(folderSchema);

async function member(role: 'designer' | 'viewer' | 'org_owner', team: string) {
  const who = await signIn(app, newIdentity(`Files ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

const newFolder = async (who: SignedIn, name: string) =>
  folderSchema.parse(
    (await mutate(app, 'post', '/api/v1/folders', who).send({ name }).expect(201)).body,
  );
const newFile = async (who: SignedIn, name: string, folderId: string | null = null) =>
  projectSchema.parse(
    (await mutate(app, 'post', '/api/v1/projects', who).send({ name, folderId }).expect(201)).body,
  );
const list = async (who: SignedIn, query: string) =>
  files.parse((await get(`/api/v1/projects${query}`, who).expect(200)).body);
const move = (who: SignedIn, file: Project, folderId: string | null) =>
  mutate(app, 'patch', `/api/v1/projects/${file.id}`, who).send({
    folderId,
    expectedUpdatedAt: file.updatedAt,
  });

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
  teamA = await team(`Files A ${String(Date.now())}`);
  teamB = await team(`Files B ${String(Date.now())}`);
  designer = await member('designer', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
}, 60_000);

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('projects (folders)', () => {
  it('are created, listed with file counts, renamed and kept unique per team', async () => {
    const payments = await newFolder(designer, 'Payments');
    expect(payments).toMatchObject({ name: 'Payments', fileCount: 0 });
    await newFile(designer, 'Checkout', payments.id);
    await newFolder(designer, 'Accounts');
    const listed = foldersList.parse((await get('/api/v1/folders', viewer).expect(200)).body);
    expect(listed.map((f) => [f.name, f.fileCount])).toEqual([
      ['Accounts', 0],
      ['Payments', 1],
    ]);
    const dup = await mutate(app, 'post', '/api/v1/folders', designer)
      .send({ name: 'payments' })
      .expect(409);
    expect(dup.body).toMatchObject({ error: { code: 'NAME_TAKEN' } });
    const renamed = folderSchema.parse(
      (
        await mutate(app, 'patch', `/api/v1/folders/${payments.id}`, designer)
          .send({ name: 'Payments 2027' })
          .expect(200)
      ).body,
    );
    expect(renamed).toMatchObject({ name: 'Payments 2027', fileCount: 1 });
    await mutate(app, 'patch', `/api/v1/folders/${payments.id}`, designer)
      .send({ name: 'Accounts' })
      .expect(409);
  });

  it('are read-only for viewers and invisible to other teams', async () => {
    await mutate(app, 'post', '/api/v1/folders', viewer).send({ name: 'Nope' }).expect(403);
    const [first] = foldersList.parse((await get('/api/v1/folders', designer).expect(200)).body);
    if (!first) throw new Error('no folder');
    expect(foldersList.parse((await get('/api/v1/folders', outsider).expect(200)).body)).toEqual(
      [],
    );
    await mutate(app, 'patch', `/api/v1/folders/${first.id}`, outsider)
      .send({ name: 'Taken over' })
      .expect(404);
    await mutate(app, 'delete', `/api/v1/folders/${first.id}`, outsider).expect(404);
    await mutate(app, 'post', '/api/v1/folders', designer).send({ name: '  ' }).expect(400);
  });
});

describe('files', () => {
  it('are created in a project or in Drafts, and filtered, searched and sorted', async () => {
    const design = await newFolder(designer, 'Design ops');
    const a = await newFile(designer, 'Alpha 100%', design.id);
    const b = await newFile(designer, 'beta onboarding', design.id);
    const draft = await newFile(designer, 'Scratch idea');
    expect(a).toMatchObject({ folderId: design.id, folderName: 'Design ops' });
    expect(draft).toMatchObject({ folderId: null, folderName: null });

    expect((await list(viewer, `?folder=${design.id}&sort=name`)).map((f) => f.name)).toEqual([
      'Alpha 100%',
      'beta onboarding',
    ]);
    const drafts = await list(viewer, '?folder=drafts');
    expect(drafts.map((f) => f.id)).toContain(draft.id);
    expect(drafts.every((f) => f.folderId === null)).toBe(true);
    // Search is case-insensitive and treats % and _ literally.
    expect((await list(viewer, '?q=ONBOARD')).map((f) => f.id)).toEqual([b.id]);
    expect((await list(viewer, `?q=${encodeURIComponent('100%')}`)).map((f) => f.id)).toEqual([
      a.id,
    ]);
    expect(await list(viewer, `?q=${encodeURIComponent('_')}`)).toEqual([]);
    await get('/api/v1/projects?sort=random', viewer).expect(400);
    await get('/api/v1/projects?folder=nope', viewer).expect(400);
  });

  it('can only be created in or moved to a project of the same team', async () => {
    const theirs = await newFolder(outsider, 'Their project');
    const res = await mutate(app, 'post', '/api/v1/projects', designer)
      .send({ name: 'Smuggled', folderId: theirs.id })
      .expect(404);
    expect(res.body).toMatchObject({ error: { code: 'FOLDER_NOT_FOUND' } });
    const file = await newFile(designer, 'Mover');
    await move(designer, file, theirs.id).expect(404);

    // Database guard below the API: a cross-team folder reference is rejected even if attempted directly.
    const db = createDatabase(pool);
    await expect(
      withDbContext(db, { organizationId: teamA, userId: designer.session.user.id }, (tx) =>
        tx.update(projectsTable).set({ folderId: theirs.id }).where(eq(projectsTable.id, file.id)),
      ),
    ).rejects.toThrow();
  });

  it('move between projects and Drafts; trashed files cannot move', async () => {
    const target = await newFolder(designer, 'Target');
    let file = await newFile(designer, 'Travelling file');
    file = projectSchema.parse((await move(designer, file, target.id).expect(200)).body);
    expect(file).toMatchObject({ folderId: target.id, folderName: 'Target' });
    file = projectSchema.parse((await move(designer, file, null).expect(200)).body);
    expect(file.folderId).toBeNull();
    await move(viewer, file, target.id).expect(403);
    await move(designer, { ...file, updatedAt: new Date(0).toISOString() }, target.id).expect(409);

    file = projectSchema.parse(
      (
        await mutate(app, 'patch', `/api/v1/projects/${file.id}`, designer)
          .send({ status: 'archived', expectedUpdatedAt: file.updatedAt })
          .expect(200)
      ).body,
    );
    const refused = await move(designer, file, target.id).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'PROJECT_ARCHIVED' } });
  });

  it('duplicate with history, new screen ids and a unique name', async () => {
    const folder = await newFolder(designer, 'Dupes');
    const source = await newFile(designer, 'Original', folder.id);
    await mutate(app, 'post', `/api/v1/projects/${source.id}/pages`, designer)
      .send({ name: 'Pricing', route: '/pricing' })
      .expect(201);
    await mutate(app, 'post', `/api/v1/projects/${source.id}/checkpoints`, designer)
      .send({ message: 'Added pricing' })
      .expect(201);

    const copy = projectSchema.parse(
      (
        await mutate(app, 'post', `/api/v1/projects/${source.id}/duplicate`, designer)
          .send({})
          .expect(201)
      ).body,
    );
    expect(copy).toMatchObject({ name: 'Original (copy)', folderId: folder.id, pageCount: 2 });
    const second = projectSchema.parse(
      (
        await mutate(app, 'post', `/api/v1/projects/${source.id}/duplicate`, designer)
          .send({})
          .expect(201)
      ).body,
    );
    expect(second.name).toBe('Original (copy 2)');
    const named = projectSchema.parse(
      (
        await mutate(app, 'post', `/api/v1/projects/${source.id}/duplicate`, designer)
          .send({ name: 'Variant B' })
          .expect(201)
      ).body,
    );
    expect(named.name).toBe('Variant B');
    await mutate(app, 'post', `/api/v1/projects/${source.id}/duplicate`, designer)
      .send({ name: 'variant b' })
      .expect(409);

    const pagesOf = async (id: string) =>
      z
        .array(pageSchema)
        .parse((await get(`/api/v1/projects/${id}/pages`, viewer).expect(200)).body);
    const [srcPages, copyPages] = [await pagesOf(source.id), await pagesOf(copy.id)];
    expect(copyPages.map((p) => [p.name, p.route, p.filePath])).toEqual(
      srcPages.map((p) => [p.name, p.route, p.filePath]),
    );
    expect(copyPages.some((p) => srcPages.some((s) => s.id === p.id))).toBe(false);

    const history = z
      .array(checkpointSchema)
      .parse((await get(`/api/v1/projects/${copy.id}/checkpoints`, viewer).expect(200)).body);
    expect(history.map((c) => c.message)).toEqual([
      'Duplicate of "Original"',
      'Added pricing',
      'Create project',
    ]);
    // The copy is independent: editing it leaves the source untouched.
    await mutate(app, 'post', `/api/v1/projects/${copy.id}/pages`, designer)
      .send({ name: 'Only in copy', route: '/only-in-copy' })
      .expect(201);
    expect((await pagesOf(source.id)).map((p) => p.route)).not.toContain('/only-in-copy');
    // Restoring a copied checkpoint works in the copy's own repository.
    const added = history.find((c) => c.message === 'Added pricing');
    await mutate(
      app,
      'post',
      `/api/v1/projects/${copy.id}/checkpoints/${added?.id ?? ''}/restore`,
      designer,
    )
      .send({})
      .expect(200);
    expect((await pagesOf(copy.id)).map((p) => p.route)).not.toContain('/only-in-copy');
  });

  it('cannot duplicate across teams, as a viewer, or from Trash', async () => {
    const file = await newFile(designer, 'Guarded');
    await mutate(app, 'post', `/api/v1/projects/${file.id}/duplicate`, outsider)
      .send({})
      .expect(404);
    await mutate(app, 'post', `/api/v1/projects/${file.id}/duplicate`, viewer).send({}).expect(403);
    await mutate(app, 'patch', `/api/v1/projects/${file.id}`, designer)
      .send({ status: 'archived', expectedUpdatedAt: file.updatedAt })
      .expect(200);
    const res = await mutate(app, 'post', `/api/v1/projects/${file.id}/duplicate`, designer)
      .send({})
      .expect(409);
    expect(res.body).toMatchObject({ error: { code: 'PROJECT_ARCHIVED' } });
  });
});

describe('deleting a project (folder)', () => {
  it('moves its files to Trash; restored files land in Drafts', async () => {
    const folder = await newFolder(designer, 'Short-lived');
    const one = await newFile(designer, 'Doomed one', folder.id);
    await newFile(designer, 'Doomed two', folder.id);
    const res = await mutate(app, 'delete', `/api/v1/folders/${folder.id}`, designer).expect(200);
    expect(res.body).toEqual({ trashedFiles: 2 });
    expect(
      foldersList
        .parse((await get('/api/v1/folders', viewer).expect(200)).body)
        .some((f) => f.id === folder.id),
    ).toBe(false);
    const trash = await list(viewer, '?status=archived');
    const trashed = trash.find((f) => f.id === one.id);
    expect(trashed).toMatchObject({ status: 'archived', folderId: null });

    const restored = projectSchema.parse(
      (
        await mutate(app, 'patch', `/api/v1/projects/${one.id}`, designer)
          .send({ status: 'active', expectedUpdatedAt: trashed?.updatedAt })
          .expect(200)
      ).body,
    );
    expect(restored).toMatchObject({ status: 'active', folderId: null });
    expect((await list(viewer, '?folder=drafts')).map((f) => f.id)).toContain(one.id);
    await mutate(app, 'delete', `/api/v1/folders/${folder.id}`, designer).expect(404);
    await mutate(app, 'delete', `/api/v1/folders/${folder.id}`, viewer).expect(403);
  });
});

it('keeps folders isolated by row-level security', async () => {
  const folder = await newFolder(designer, 'RLS check');
  const db = createDatabase(pool);
  const { folders } = await import('../../src/db/schema.js');
  const seen = await withDbContext(
    db,
    { organizationId: teamB, userId: outsider.session.user.id },
    (tx) => tx.select().from(folders).where(eq(folders.id, folder.id)),
  );
  expect(seen).toEqual([]);
});
