import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  checkpointSchema,
  pageSchema,
  type Project,
  projectRepositorySchema,
  projectSchema,
} from '@core-studio/contracts';
import { parseManifest } from '@core-studio/project-template';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withTenant } from '../../src/db/database.js';
import { projectPages, projects } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp, TEST_BUNDLE_ROOT, TEST_REPO_ROOT } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

let app: NestExpressApplication;
let pool: pg.Pool;
let admin: SignedIn;
let designer: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let team: string;
let project: Project;

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
const pages = z.array(pageSchema);
const checkpoints = z.array(checkpointSchema);
const repoDir = () => join(TEST_REPO_ROOT, team, project.id, 'repo');
const file = (path: string) => readFileSync(join(repoDir(), path), 'utf8');
const git = (...args: string[]) =>
  execFileSync('git', ['-C', repoDir(), ...args], { encoding: 'utf8' }).trim();
const listPages = async (who = designer) =>
  pages.parse((await get(`/api/v1/projects/${project.id}/pages`, who).expect(200)).body);
const repository = async (who = designer) =>
  projectRepositorySchema.parse(
    (await get(`/api/v1/projects/${project.id}/repository`, who).expect(200)).body,
  );
const addPage = (name: string, route: string, who = designer) =>
  mutate(app, 'post', `/api/v1/projects/${project.id}/pages`, who).send({ name, route });

async function member(role: 'designer' | 'viewer' | 'org_owner', teamId: string) {
  const who = await signIn(app, newIdentity(`Repo ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${teamId}/members`, admin)
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
  team = await newTeam(`Repos A ${String(Date.now())}`);
  const other = await newTeam(`Repos B ${String(Date.now())}`);
  designer = await member('designer', team);
  viewer = await member('viewer', team);
  outsider = await member('org_owner', other);
  project = projectSchema.parse(
    (
      await mutate(app, 'post', '/api/v1/projects', designer)
        .send({ name: 'Storefront' })
        .expect(201)
    ).body,
  );
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('repository initialisation', () => {
  it('creates a git repository from the template with a first checkpoint', async () => {
    expect(existsSync(join(repoDir(), '.git'))).toBe(true);
    expect(git('log', '--format=%s')).toBe('Create project');
    expect(git('log', '--format=%an <%ae>')).toBe(
      `Repo designer <user-${designer.session.user.id}@users.core-studio.invalid>`,
    );
    expect(git('status', '--porcelain')).toBe('');
    const manifest = parseManifest(file('core.project.json'));
    expect(manifest.pages).toMatchObject([
      { name: 'Home', route: '/', folder: 'home', component: 'HomePage' },
    ]);
    expect(file('src/app/routes.ts')).toContain('../pages/home/HomePage');
    const [home] = await listPages();
    expect(home).toMatchObject({
      id: manifest.pages[0]?.id,
      filePath: 'src/pages/home/HomePage.tsx',
    });
    expect(await repository()).toMatchObject({
      status: 'ready',
      templateVersion: '1',
      workingRevision: 1,
      dirty: false,
    });
    const history = checkpoints.parse(
      (await get(`/api/v1/projects/${project.id}/checkpoints`, viewer).expect(200)).body,
    );
    expect(history).toMatchObject([
      { kind: 'create', message: 'Create project', authorName: 'Repo designer' },
    ]);
  });

  it('is isolated per team', async () => {
    await get(`/api/v1/projects/${project.id}/repository`, outsider).expect(404);
    await get(`/api/v1/projects/${project.id}/checkpoints`, outsider).expect(404);
  });
});

describe('pages are source files', () => {
  let pricingId: string;

  it('creates a page component and route', async () => {
    const page = pageSchema.parse((await addPage('Pricing', '/pricing').expect(201)).body);
    pricingId = page.id;
    expect(page.filePath).toBe('src/pages/pricing/PricingPage.tsx');
    expect(file(page.filePath ?? '')).toContain('export default function PricingPage()');
    expect(file('src/app/routes.ts')).toContain(
      '{ path: "/pricing", Component: lazy(() => import("../pages/pricing/PricingPage")) }',
    );
    expect(await repository()).toMatchObject({ workingRevision: 2, dirty: true });
  });

  it('keeps the folder on rename and route change', async () => {
    const [, current] = await listPages();
    const res = await mutate(
      app,
      'patch',
      `/api/v1/projects/${project.id}/pages/${pricingId}`,
      designer,
    )
      .send({ name: 'Plans', route: '/plans', expectedUpdatedAt: current?.updatedAt })
      .expect(200);
    expect(pageSchema.parse(res.body)).toMatchObject({
      name: 'Plans',
      route: '/plans',
      filePath: 'src/pages/pricing/PricingPage.tsx',
    });
    expect(parseManifest(file('core.project.json')).pages[1]).toMatchObject({
      name: 'Plans',
      route: '/plans',
      folder: 'pricing',
    });
    expect(file('src/app/routes.ts')).toContain('"/plans"');
  });

  it('serialises concurrent writers and never reuses folders', async () => {
    const [a, b] = await Promise.all([addPage('Docs', '/docs'), addPage('Docs', '/docs-two')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const files = [pageSchema.parse(a.body).filePath, pageSchema.parse(b.body).filePath].sort();
    expect(files).toEqual(['src/pages/docs-2/Docs2Page.tsx', 'src/pages/docs/DocsPage.tsx']);
    const dup = await addPage('Again', '/docs').expect(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('ROUTE_TAKEN');
  });

  it('deletes the page folder and route', async () => {
    const docs = (await listPages()).find((p) => p.route === '/docs-two');
    await mutate(
      app,
      'delete',
      `/api/v1/projects/${project.id}/pages/${docs?.id ?? ''}`,
      designer,
    ).expect(204);
    expect(existsSync(join(repoDir(), 'src/pages/docs-2'))).toBe(false);
    expect(file('src/app/routes.ts')).not.toContain('docs-two');
  });

  it('are read-only for viewers', async () => {
    await addPage('Nope', '/nope', viewer).expect(403);
    await mutate(app, 'post', `/api/v1/projects/${project.id}/checkpoints`, viewer)
      .send({ message: 'x' })
      .expect(403);
  });
});

describe('checkpoints', () => {
  let afterPagesId: string;

  it('commit the working tree and refuse empty checkpoints', async () => {
    const res = await mutate(app, 'post', `/api/v1/projects/${project.id}/checkpoints`, designer)
      .send({ message: 'Add pricing and docs' })
      .expect(201);
    const checkpoint = checkpointSchema.parse(res.body);
    afterPagesId = checkpoint.id;
    expect(git('rev-parse', 'HEAD')).toBe(checkpoint.commitSha);
    expect(git('log', '-1', '--format=%s')).toBe('Add pricing and docs');
    expect(await repository()).toMatchObject({ dirty: false, headCommit: checkpoint.commitSha });
    const empty = await mutate(app, 'post', `/api/v1/projects/${project.id}/checkpoints`, designer)
      .send({ message: 'Nothing' })
      .expect(409);
    expect((empty.body as { error: { code: string } }).error.code).toBe('NOTHING_TO_SAVE');
  });

  it('write a backup bundle that restores to an identical tree', () => {
    const dir = join(TEST_BUNDLE_ROOT, team, project.id);
    const bundles = readdirSync(dir)
      .filter((f) => f.endsWith('.bundle'))
      .sort();
    expect(bundles.length).toBeGreaterThan(0);
    const clone = join(mkdtempSync(join(tmpdir(), 'restore-')), 'repo');
    execFileSync('git', ['clone', '--quiet', join(dir, bundles.at(-1) ?? ''), clone]);
    expect(
      execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
    ).toBe(git('rev-parse', 'HEAD^{tree}'));
  });

  it('restore as a new commit after a safety checkpoint, never rewriting history', async () => {
    const commitsBefore = Number(git('rev-list', '--count', 'HEAD'));
    await addPage('Unsaved', '/unsaved').expect(201);
    const history = checkpoints.parse(
      (await get(`/api/v1/projects/${project.id}/checkpoints`, designer).expect(200)).body,
    );
    const create = history.find((c) => c.kind === 'create');
    const res = await mutate(
      app,
      'post',
      `/api/v1/projects/${project.id}/checkpoints/${create?.id ?? ''}/restore`,
      designer,
    )
      .send({})
      .expect(200);
    const restored = checkpointSchema.parse(res.body);
    expect(restored).toMatchObject({ kind: 'restore', restoredFrom: create?.id });
    expect(Number(git('rev-list', '--count', 'HEAD'))).toBe(commitsBefore + 2);
    expect(git('log', '-2', '--format=%s').split('\n')).toEqual([
      'Restore to "Create project"',
      'Before restore (automatic)',
    ]);
    expect((await listPages()).map((p) => p.route)).toEqual(['/']);
    expect(existsSync(join(repoDir(), 'src/pages/pricing'))).toBe(false);
    expect(git('status', '--porcelain')).toBe('');

    // Restoring forward again brings the pages back.
    await mutate(
      app,
      'post',
      `/api/v1/projects/${project.id}/checkpoints/${afterPagesId}/restore`,
      designer,
    )
      .send({})
      .expect(200);
    expect((await listPages()).map((p) => p.route)).toEqual(['/', '/plans', '/docs']);
  });

  it('cannot restore checkpoints of another project', async () => {
    const other = projectSchema.parse(
      (
        await mutate(app, 'post', '/api/v1/projects', designer)
          .send({ name: 'Other app' })
          .expect(201)
      ).body,
    );
    await mutate(
      app,
      'post',
      `/api/v1/projects/${other.id}/checkpoints/${afterPagesId}/restore`,
      designer,
    )
      .send({})
      .expect(404);
  });
});

describe('integrity and recovery', () => {
  it('repairs the page projection when a request changed files but its database transaction did not commit', async () => {
    const manifest = parseManifest(file('core.project.json'));
    const renamed = {
      ...manifest,
      pages: manifest.pages.map((p) => (p.route === '/docs' ? { ...p, name: 'Documentation' } : p)),
    };
    writeFileSync(join(repoDir(), 'core.project.json'), `${JSON.stringify(renamed, null, 2)}\n`);
    const marker = join(repoDir(), '.git', 'core-revision');
    writeFileSync(marker, `${String(Number(readFileSync(marker, 'utf8')) + 1)}\n`);
    expect((await listPages()).find((p) => p.route === '/docs')?.name).toBe('Documentation');
  });

  it('creates repositories lazily for projects that predate them (backfill)', async () => {
    const db = createDatabase(pool);
    const legacyId = randomUUID();
    await withTenant(db, team, async (tx) => {
      await tx
        .insert(projects)
        .values({ id: legacyId, organizationId: team, name: `Legacy ${String(Date.now())}` });
      await tx.insert(projectPages).values([
        { projectId: legacyId, organizationId: team, name: 'Home', route: '/', position: 0 },
        {
          projectId: legacyId,
          organizationId: team,
          name: 'About Us',
          route: '/about',
          position: 1,
        },
      ]);
    });
    const res = await get(`/api/v1/projects/${legacyId}/pages`, viewer).expect(200);
    expect(pages.parse(res.body).map((p) => p.filePath)).toEqual([
      'src/pages/home/HomePage.tsx',
      'src/pages/about-us/AboutUsPage.tsx',
    ]);
    expect(
      existsSync(
        join(TEST_REPO_ROOT, team, legacyId, 'repo', 'src/pages/about-us/AboutUsPage.tsx'),
      ),
    ).toBe(true);
  });

  it('refuses checkpoints on archived projects', async () => {
    const current = projectSchema.parse(
      (await get(`/api/v1/projects/${project.id}`, designer).expect(200)).body,
    );
    await mutate(app, 'patch', `/api/v1/projects/${project.id}`, designer)
      .send({ status: 'archived', expectedUpdatedAt: current.updatedAt })
      .expect(200);
    const res = await mutate(app, 'post', `/api/v1/projects/${project.id}/checkpoints`, designer)
      .send({ message: 'x' })
      .expect(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('PROJECT_ARCHIVED');
    expect(git('fsck', '--no-dangling')).toBe('');
  });
});
