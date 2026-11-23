import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CommentReply,
  CommentThread,
  CreateComment,
  MembershipRole,
} from '@core-studio/contracts';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { comments, projectPages, projects, users } from '../db/schema.js';

const TEAM_ADMINS: readonly MembershipRole[] = ['org_admin', 'org_owner'];

const resolver = alias(users, 'resolver');
const columns = {
  id: comments.id,
  projectId: comments.projectId,
  pageId: comments.pageId,
  x: comments.x,
  y: comments.y,
  parentId: comments.parentId,
  body: comments.body,
  authorId: comments.authorId,
  authorName: users.displayName,
  edited: comments.edited,
  resolvedAt: comments.resolvedAt,
  resolvedById: comments.resolvedBy,
  resolvedByName: resolver.displayName,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
};

interface Row {
  id: string;
  projectId: string;
  pageId: string | null;
  x: number | null;
  y: number | null;
  parentId: string | null;
  body: string;
  authorId: string | null;
  authorName: string | null;
  edited: boolean;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toReply = (row: Row & { parentId: string }): CommentReply => ({
  id: row.id,
  parentId: row.parentId,
  body: row.body,
  authorId: row.authorId,
  authorName: row.authorName,
  edited: row.edited,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toThread = (row: Row, replies: CommentReply[]): CommentThread => ({
  id: row.id,
  projectId: row.projectId,
  pageId: row.pageId,
  x: row.x,
  y: row.y,
  body: row.body,
  authorId: row.authorId,
  authorName: row.authorName,
  edited: row.edited,
  resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  resolvedById: row.resolvedById,
  resolvedByName: row.resolvedByName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  replies,
});

/** Builds threads (top-level comments, oldest first) with their replies from rows in time order. */
function toThreads(rows: Row[]): CommentThread[] {
  const replies = new Map<string, CommentReply[]>();
  for (const row of rows)
    if (row.parentId) {
      const list = replies.get(row.parentId) ?? [];
      list.push(toReply({ ...row, parentId: row.parentId }));
      replies.set(row.parentId, list);
    }
  return rows.filter((r) => !r.parentId).map((r) => toThread(r, replies.get(r.id) ?? []));
}

const commentNotFound = () =>
  new NotFoundException({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });

/**
 * Figma-style comments on a file (`projects` row, ADR-0014). Threads are pinned to a screen or to
 * the file; replies are one level deep. RLS scopes every query to the active team. Files in Trash
 * are read-only.
 */
@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private run<T>(auth: AuthContext, fn: (tx: Database, organizationId: string) => Promise<T>) {
    if (!auth.organizationId) throw new ForbiddenException('Select a team first');
    const ctx = {
      organizationId: auth.organizationId,
      userId: auth.userId,
      platformAdmin: auth.platformAdmin,
    };
    return withDbContext(this.db, ctx, (tx) => fn(tx, ctx.organizationId));
  }

  /** The file must be visible; writes take a share lock so it cannot be trashed concurrently. */
  private async file(tx: Database, projectId: string, write: boolean) {
    const query = tx
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId));
    const [row] = write ? await query.for('share') : await query;
    if (!row) throw new NotFoundException('Project not found');
    if (write && row.status !== 'active')
      throw new ConflictException({
        code: 'PROJECT_ARCHIVED',
        message: 'Restore the file from Trash before commenting.',
      });
  }

  private select(tx: Database) {
    return tx
      .select(columns)
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .leftJoin(resolver, eq(resolver.id, comments.resolvedBy));
  }

  /** A comment of this file (thread or reply), locked for the change. */
  private async comment(tx: Database, projectId: string, id: string) {
    const [row] = await tx
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.projectId, projectId)))
      .for('update');
    if (!row) throw commentNotFound();
    return row;
  }

  private async thread(tx: Database, projectId: string, threadId: string) {
    const rows = await this.select(tx)
      .where(
        and(
          eq(comments.projectId, projectId),
          or(eq(comments.id, threadId), eq(comments.parentId, threadId)),
        ),
      )
      .orderBy(asc(comments.createdAt), asc(comments.id));
    const [thread] = toThreads(rows);
    if (!thread) throw commentNotFound();
    return thread;
  }

  list(auth: AuthContext, projectId: string, includeResolved: boolean): Promise<CommentThread[]> {
    return this.run(auth, async (tx) => {
      await this.file(tx, projectId, false);
      const rows = await this.select(tx)
        .where(eq(comments.projectId, projectId))
        .orderBy(asc(comments.createdAt), asc(comments.id));
      const threads = toThreads(rows);
      return includeResolved ? threads : threads.filter((t) => t.resolvedAt === null);
    });
  }

  create(
    auth: AuthContext,
    projectId: string,
    input: CreateComment,
    correlationId: string,
  ): Promise<CommentThread> {
    return this.run(auth, async (tx, organizationId) => {
      await this.file(tx, projectId, true);
      if (input.pageId) {
        const [page] = await tx
          .select({ id: projectPages.id })
          .from(projectPages)
          .where(and(eq(projectPages.id, input.pageId), eq(projectPages.projectId, projectId)));
        if (!page)
          throw new NotFoundException({ code: 'PAGE_NOT_FOUND', message: 'Screen not found' });
      }
      const [row] = await tx
        .insert(comments)
        .values({
          organizationId,
          projectId,
          pageId: input.pageId,
          x: input.x,
          y: input.y,
          body: input.body,
          authorId: auth.userId,
        })
        .returning({ id: comments.id });
      if (!row) throw new Error('Insert returned no row');
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'comment.created',
        targetType: 'comment',
        targetId: row.id,
        correlationId,
        metadata: { projectId, pageId: input.pageId, pinned: input.x !== null },
      });
      return this.thread(tx, projectId, row.id);
    });
  }

  reply(
    auth: AuthContext,
    projectId: string,
    threadId: string,
    body: string,
    correlationId: string,
  ): Promise<CommentThread> {
    return this.run(auth, async (tx, organizationId) => {
      await this.file(tx, projectId, true);
      const parent = await this.comment(tx, projectId, threadId);
      if (parent.parentId)
        throw new BadRequestException({
          code: 'NESTED_REPLY',
          message: 'Reply to the thread, not to a reply.',
        });
      const [row] = await tx
        .insert(comments)
        .values({ organizationId, projectId, parentId: threadId, body, authorId: auth.userId })
        .returning({ id: comments.id });
      if (!row) throw new Error('Insert returned no row');
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'comment.replied',
        targetType: 'comment',
        targetId: row.id,
        correlationId,
        metadata: { projectId, threadId },
      });
      return this.thread(tx, projectId, threadId);
    });
  }

  /** Only the author may edit; returns the whole thread the comment belongs to. */
  edit(
    auth: AuthContext,
    projectId: string,
    id: string,
    body: string,
    correlationId: string,
  ): Promise<CommentThread> {
    return this.run(auth, async (tx, organizationId) => {
      await this.file(tx, projectId, true);
      const current = await this.comment(tx, projectId, id);
      if (current.authorId !== auth.userId)
        throw new ForbiddenException({
          code: 'NOT_AUTHOR',
          message: 'Only the author can edit this comment.',
        });
      await tx
        .update(comments)
        .set({ body, edited: true, updatedAt: sql`now()` })
        .where(eq(comments.id, id));
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'comment.edited',
        targetType: 'comment',
        targetId: id,
        correlationId,
        metadata: { projectId },
      });
      return this.thread(tx, projectId, current.parentId ?? id);
    });
  }

  setResolved(
    auth: AuthContext,
    projectId: string,
    id: string,
    resolved: boolean,
    correlationId: string,
  ): Promise<CommentThread> {
    return this.run(auth, async (tx, organizationId) => {
      await this.file(tx, projectId, true);
      const current = await this.comment(tx, projectId, id);
      if (current.parentId)
        throw new BadRequestException({
          code: 'NOT_A_THREAD',
          message: 'Only a thread can be resolved or reopened.',
        });
      if ((current.resolvedAt !== null) !== resolved) {
        await tx
          .update(comments)
          .set(
            resolved
              ? { resolvedAt: sql`now()`, resolvedBy: auth.userId, updatedAt: sql`now()` }
              : { resolvedAt: null, resolvedBy: null, updatedAt: sql`now()` },
          )
          .where(eq(comments.id, id));
        await this.audit.record(tx, {
          organizationId,
          actorId: auth.userId,
          action: resolved ? 'comment.resolved' : 'comment.reopened',
          targetType: 'comment',
          targetId: id,
          correlationId,
          metadata: { projectId },
        });
      }
      return this.thread(tx, projectId, id);
    });
  }

  /** The author, or a team admin/owner. Deleting a thread deletes its replies. */
  remove(auth: AuthContext, projectId: string, id: string, correlationId: string): Promise<void> {
    return this.run(auth, async (tx, organizationId) => {
      await this.file(tx, projectId, true);
      const current = await this.comment(tx, projectId, id);
      const teamAdmin = auth.role !== null && TEAM_ADMINS.includes(auth.role);
      if (current.authorId !== auth.userId && !teamAdmin)
        throw new ForbiddenException({
          code: 'NOT_AUTHOR',
          message: 'Only the author or a team admin can delete this comment.',
        });
      const deleted = await tx
        .delete(comments)
        .where(or(eq(comments.id, id), eq(comments.parentId, id)))
        .returning({ id: comments.id });
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'comment.deleted',
        targetType: 'comment',
        targetId: id,
        correlationId,
        metadata: {
          projectId,
          threadId: current.parentId,
          deletedReplies: deleted.length - 1,
          byAuthor: current.authorId === auth.userId,
        },
      });
    });
  }
}
