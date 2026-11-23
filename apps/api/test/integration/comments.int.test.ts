import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  type CommentThread,
  commentThreadSchema,
  pageSchema,
  type Project,
  projectSchema,
} from '@core-studio/contracts';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, createPool, withDbContext } from '../../src/db/database.js';
import { auditEvents, comments as commentsTable } from '../../src/db/schema.js';
import { requireEnv } from './env.js';
import { ADMIN_OID, createTestApp } from './support/app.js';
import { mutate, newIdentity, refreshSession, type SignedIn, signIn } from './support/oidc.js';

/** Figma-style comments on a file: pins on screens, threads with one level of replies. */
let app: NestExpressApplication;
let pool: pg.Pool;
let admin: SignedIn;
let designer: SignedIn;
let designer2: SignedIn;
let teamAdmin: SignedIn;
let viewer: SignedIn;
let outsider: SignedIn;
let teamA: string;
let teamB: string;
let file: Project;
let homePageId: string;

const get = (path: string, who: SignedIn) =>
  request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
const threads = z.array(commentThreadSchema);

async function member(role: 'designer' | 'viewer' | 'org_admin' | 'org_owner', team: string) {
  const who = await signIn(app, newIdentity(`Comments ${role}`));
  await mutate(app, 'post', `/api/v1/orgs/${team}/members`, admin)
    .send({ userId: who.session.user.id, role })
    .expect(204);
  return refreshSession(app, who);
}

const newFile = async (who: SignedIn, name: string) =>
  projectSchema.parse(
    (await mutate(app, 'post', '/api/v1/projects', who).send({ name }).expect(201)).body,
  );
const url = (projectId: string, suffix = '') => `/api/v1/projects/${projectId}/comments${suffix}`;
const listOf = async (who: SignedIn, projectId: string, query = '') =>
  threads.parse((await get(url(projectId, query), who).expect(200)).body);
const post = async (who: SignedIn, projectId: string, body: Record<string, unknown>) =>
  commentThreadSchema.parse(
    (await mutate(app, 'post', url(projectId), who).send(body).expect(201)).body,
  );
const replyTo = async (who: SignedIn, thread: CommentThread, body: string) =>
  commentThreadSchema.parse(
    (
      await mutate(app, 'post', url(thread.projectId, `/${thread.id}/replies`), who)
        .send({ body })
        .expect(201)
    ).body,
  );

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
  teamA = await team(`Comments A ${String(Date.now())}`);
  teamB = await team(`Comments B ${String(Date.now())}`);
  designer = await member('designer', teamA);
  designer2 = await member('designer', teamA);
  teamAdmin = await member('org_admin', teamA);
  viewer = await member('viewer', teamA);
  outsider = await member('org_owner', teamB);
  file = await newFile(designer, 'Commented file');
  const pages = z
    .array(pageSchema)
    .parse((await get(`/api/v1/projects/${file.id}/pages`, designer).expect(200)).body);
  homePageId = pages[0]?.id ?? '';
}, 60_000);

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('comments', () => {
  it('are pinned to a screen or the file, replied to, and listed as threads', async () => {
    const pinned = await post(designer, file.id, {
      pageId: homePageId,
      x: 0.25,
      y: 0.75,
      body: '  Make this button bigger  ',
    });
    expect(pinned).toMatchObject({
      projectId: file.id,
      pageId: homePageId,
      x: 0.25,
      y: 0.75,
      body: 'Make this button bigger',
      authorId: designer.session.user.id,
      authorName: 'Comments designer',
      edited: false,
      resolvedAt: null,
      replies: [],
    });
    const fileLevel = await post(designer2, file.id, { body: 'Overall looks good' });
    expect(fileLevel).toMatchObject({ pageId: null, x: null, y: null });
    const screenLevel = await post(designer2, file.id, { pageId: homePageId, body: 'On Home' });
    expect(screenLevel).toMatchObject({ pageId: homePageId, x: null, y: null });

    const withReply = await replyTo(designer2, pinned, 'Agreed, 48px?');
    expect(withReply.replies).toHaveLength(1);
    expect(withReply.replies[0]).toMatchObject({
      parentId: pinned.id,
      body: 'Agreed, 48px?',
      authorId: designer2.session.user.id,
    });
    await replyTo(designer, pinned, 'Yes');

    // Viewers can read everything, oldest thread first, replies in order.
    const listed = await listOf(viewer, file.id);
    expect(listed.map((t) => t.id)).toEqual([pinned.id, fileLevel.id, screenLevel.id]);
    expect(listed[0]?.replies.map((r) => r.body)).toEqual(['Agreed, 48px?', 'Yes']);

    const audit = await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: designer.session.user.id },
      (tx) =>
        tx
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(and(eq(auditEvents.targetType, 'comment'), eq(auditEvents.targetId, pinned.id))),
    );
    expect(audit.map((a) => a.action)).toEqual(['comment.created']);
  });

  it('validate the body, the pin and the screen', async () => {
    const bad = (body: Record<string, unknown>) =>
      mutate(app, 'post', url(file.id), designer).send(body).expect(400);
    await bad({ body: '   ' });
    await bad({ body: 'x'.repeat(4001) });
    await bad({ pageId: homePageId, x: 0.5, body: 'only x' });
    await bad({ pageId: homePageId, x: 1.5, y: 0.5, body: 'outside' });
    await bad({ pageId: homePageId, x: -0.1, y: 0.5, body: 'outside' });
    await bad({ x: 0.5, y: 0.5, body: 'pin without a screen' });
    await bad({ pageId: 'not-a-uuid', body: 'bad id' });
    await get(url(file.id, '?includeResolved=maybe'), viewer).expect(400);
    expect((await post(designer, file.id, { body: 'x'.repeat(4000) })).body.length).toBe(4000);

    // A screen of another file of the same team cannot be referenced.
    const other = await newFile(designer, 'Other commented file');
    const otherPages = z
      .array(pageSchema)
      .parse((await get(`/api/v1/projects/${other.id}/pages`, designer).expect(200)).body);
    const res = await mutate(app, 'post', url(file.id), designer)
      .send({ pageId: otherPages[0]?.id, x: 0.1, y: 0.1, body: 'Wrong file' })
      .expect(404);
    expect(res.body).toMatchObject({ error: { code: 'PAGE_NOT_FOUND' } });
  });

  it('cannot reply to a reply; replies to unknown threads are 404', async () => {
    const thread = await post(designer, file.id, { body: 'Thread' });
    const replied = await replyTo(designer2, thread, 'First reply');
    const reply = replied.replies[0];
    if (!reply) throw new Error('reply missing');
    const nested = await mutate(app, 'post', url(file.id, `/${reply.id}/replies`), designer)
      .send({ body: 'Nested' })
      .expect(400);
    expect(nested.body).toMatchObject({ error: { code: 'NESTED_REPLY' } });
    await mutate(app, 'post', url(file.id, `/${crypto.randomUUID()}/replies`), designer)
      .send({ body: 'Nowhere' })
      .expect(404);
    // A thread of another file cannot be replied to through this file.
    const other = await newFile(designer, 'Reply elsewhere');
    await mutate(app, 'post', url(other.id, `/${thread.id}/replies`), designer)
      .send({ body: 'Wrong file' })
      .expect(404);
  });

  it('are edited only by their author', async () => {
    const thread = await post(designer, file.id, { body: 'Typo hree' });
    const edited = commentThreadSchema.parse(
      (
        await mutate(app, 'patch', url(file.id, `/${thread.id}`), designer)
          .send({ body: 'Typo here' })
          .expect(200)
      ).body,
    );
    expect(edited).toMatchObject({ id: thread.id, body: 'Typo here', edited: true });

    const forbidden = await mutate(app, 'patch', url(file.id, `/${thread.id}`), designer2)
      .send({ body: 'Hijacked' })
      .expect(403);
    expect(forbidden.body).toMatchObject({ error: { code: 'NOT_AUTHOR' } });
    // Not even team admins edit other people's words.
    await mutate(app, 'patch', url(file.id, `/${thread.id}`), teamAdmin)
      .send({ body: 'Hijacked' })
      .expect(403);
    await mutate(app, 'patch', url(file.id, `/${thread.id}`), designer)
      .send({ body: '' })
      .expect(400);

    // Editing a reply returns its whole thread.
    const replied = await replyTo(designer2, thread, 'Reply v1');
    const reply = replied.replies[0];
    const afterReplyEdit = commentThreadSchema.parse(
      (
        await mutate(app, 'patch', url(file.id, `/${reply?.id ?? ''}`), designer2)
          .send({ body: 'Reply v2' })
          .expect(200)
      ).body,
    );
    expect(afterReplyEdit.id).toBe(thread.id);
    expect(afterReplyEdit.replies[0]).toMatchObject({ body: 'Reply v2', edited: true });
  });

  it('threads are resolved and reopened; resolved ones are hidden by default', async () => {
    const thread = await post(designer, file.id, { pageId: homePageId, x: 0, y: 1, body: 'Fix' });
    const replied = await replyTo(designer2, thread, 'Done');
    const resolved = commentThreadSchema.parse(
      (await mutate(app, 'post', url(file.id, `/${thread.id}/resolve`), designer2).expect(200))
        .body,
    );
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved).toMatchObject({
      resolvedById: designer2.session.user.id,
      resolvedByName: 'Comments designer',
    });
    expect((await listOf(viewer, file.id)).some((t) => t.id === thread.id)).toBe(false);
    expect(
      (await listOf(viewer, file.id, '?includeResolved=true')).some((t) => t.id === thread.id),
    ).toBe(true);

    // Replies are not threads.
    const notThread = await mutate(
      app,
      'post',
      url(file.id, `/${replied.replies[0]?.id ?? ''}/resolve`),
      designer,
    ).expect(400);
    expect(notThread.body).toMatchObject({ error: { code: 'NOT_A_THREAD' } });

    const reopened = commentThreadSchema.parse(
      (await mutate(app, 'post', url(file.id, `/${thread.id}/reopen`), designer).expect(200)).body,
    );
    expect(reopened).toMatchObject({ resolvedAt: null, resolvedById: null, resolvedByName: null });
    expect((await listOf(viewer, file.id)).some((t) => t.id === thread.id)).toBe(true);
  });

  it('are deleted by their author or a team admin; deleting a thread deletes its replies', async () => {
    const mine = await post(designer, file.id, { body: 'Delete me' });
    await mutate(app, 'delete', url(file.id, `/${mine.id}`), designer2).expect(403);
    await mutate(app, 'delete', url(file.id, `/${mine.id}`), designer).expect(204);
    await mutate(app, 'delete', url(file.id, `/${mine.id}`), designer).expect(404);

    const thread = await post(designer, file.id, { body: 'Moderated' });
    const replied = await replyTo(designer2, thread, 'Off-topic');
    // The author of a reply deletes only the reply.
    await mutate(app, 'delete', url(file.id, `/${replied.replies[0]?.id ?? ''}`), designer2).expect(
      204,
    );
    await replyTo(designer2, thread, 'Another one');
    await mutate(app, 'delete', url(file.id, `/${thread.id}`), teamAdmin).expect(204);
    const left = await withDbContext(
      createDatabase(pool),
      { organizationId: teamA, userId: designer.session.user.id },
      (tx) => tx.select().from(commentsTable).where(eq(commentsTable.parentId, thread.id)),
    );
    expect(left).toEqual([]);
    expect((await listOf(viewer, file.id)).some((t) => t.id === thread.id)).toBe(false);
  });

  it('are read-only for viewers', async () => {
    const thread = await post(designer, file.id, { body: 'Viewer check' });
    await mutate(app, 'post', url(file.id), viewer).send({ body: 'Hi' }).expect(403);
    await mutate(app, 'post', url(file.id, `/${thread.id}/replies`), viewer)
      .send({ body: 'Hi' })
      .expect(403);
    await mutate(app, 'post', url(file.id, `/${thread.id}/resolve`), viewer).expect(403);
    await mutate(app, 'delete', url(file.id, `/${thread.id}`), viewer).expect(403);
  });

  it('are invisible to other teams (API and row-level security)', async () => {
    const thread = await post(designer, file.id, { body: 'Team secret' });
    await get(url(file.id), outsider).expect(404);
    await mutate(app, 'post', url(file.id), outsider).send({ body: 'Intruder' }).expect(404);
    await mutate(app, 'post', url(file.id, `/${thread.id}/replies`), outsider)
      .send({ body: 'Intruder' })
      .expect(404);
    await mutate(app, 'patch', url(file.id, `/${thread.id}`), outsider)
      .send({ body: 'Intruder' })
      .expect(404);
    await mutate(app, 'delete', url(file.id, `/${thread.id}`), outsider).expect(404);
    // The outsider's own file does not expose comments of another file either.
    const theirs = await newFile(outsider, 'Their file');
    await mutate(app, 'delete', url(theirs.id, `/${thread.id}`), outsider).expect(404);

    const db = createDatabase(pool);
    const seen = await withDbContext(
      db,
      { organizationId: teamB, userId: outsider.session.user.id },
      (tx) => tx.select().from(commentsTable).where(eq(commentsTable.projectId, file.id)),
    );
    expect(seen).toEqual([]);
    // Writing a comment into another team's file is refused below the API, too.
    await expect(
      withDbContext(db, { organizationId: teamB, userId: outsider.session.user.id }, (tx) =>
        tx.insert(commentsTable).values({
          organizationId: teamA,
          projectId: file.id,
          body: 'Smuggled',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withDbContext(db, { organizationId: teamB, userId: outsider.session.user.id }, (tx) =>
        tx.insert(commentsTable).values({
          organizationId: teamB,
          projectId: file.id,
          body: 'Smuggled',
        }),
      ),
    ).rejects.toThrow();
  });

  it('on a trashed file can be read but not written', async () => {
    const trashed = await newFile(designer, 'Trashed with comments');
    const thread = await post(designer, trashed.id, { body: 'Before trash' });
    await mutate(app, 'patch', `/api/v1/projects/${trashed.id}`, designer)
      .send({ status: 'archived', expectedUpdatedAt: trashed.updatedAt })
      .expect(200);
    expect((await listOf(viewer, trashed.id)).map((t) => t.id)).toEqual([thread.id]);
    const writes = [
      mutate(app, 'post', url(trashed.id), designer).send({ body: 'After trash' }),
      mutate(app, 'post', url(trashed.id, `/${thread.id}/replies`), designer).send({ body: 'r' }),
      mutate(app, 'patch', url(trashed.id, `/${thread.id}`), designer).send({ body: 'edit' }),
      mutate(app, 'post', url(trashed.id, `/${thread.id}/resolve`), designer),
      mutate(app, 'delete', url(trashed.id, `/${thread.id}`), designer),
    ];
    for (const write of writes) {
      const res = await write.expect(409);
      expect(res.body).toMatchObject({ error: { code: 'PROJECT_ARCHIVED' } });
    }
  });

  it('keep their thread when the screen is deleted (pin becomes file-level)', async () => {
    const own = await newFile(designer, 'Screen removal');
    const page = pageSchema.parse(
      (
        await mutate(app, 'post', `/api/v1/projects/${own.id}/pages`, designer)
          .send({ name: 'Pricing', route: '/pricing' })
          .expect(201)
      ).body,
    );
    const thread = await post(designer, own.id, { pageId: page.id, x: 0.5, y: 0.5, body: 'Pin' });
    await mutate(app, 'delete', `/api/v1/projects/${own.id}/pages/${page.id}`, designer).expect(
      204,
    );
    const [after] = await listOf(viewer, own.id);
    expect(after).toMatchObject({ id: thread.id, pageId: null });
  });
});
