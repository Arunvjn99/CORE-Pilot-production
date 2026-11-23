import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateKnowledgeDocument,
  KNOWLEDGE_MAX_DOCUMENTS,
  KNOWLEDGE_RUN_BUDGET,
  type KnowledgeDocument,
  type UpdateKnowledgeDocument,
} from '@core-studio/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { knowledgeDocuments, users } from '../db/schema.js';

const conflict = (code: string, message: string) => new ConflictException({ code, message });

/** What a run used from the knowledge base (stored on the run row). */
export interface KnowledgeUsed {
  id: string;
  title: string;
  truncated: boolean;
}

const HEADER =
  '## Team knowledge\n\nYour team keeps these documents for every design. Follow them: they take ' +
  'precedence over general assumptions about the product, its content and its wording.';

/**
 * Builds the `## Team knowledge` section the agents receive, within `budget` characters (plus a
 * one-line note when cut). Documents are taken in order; the first that does not fit is cut and
 * the rest are left out, and the note tells the agents so.
 */
export function knowledgeSection(
  documents: { id: string; title: string; body: string }[],
  budget = KNOWLEDGE_RUN_BUDGET,
): { markdown: string; used: KnowledgeUsed[] } {
  if (documents.length === 0) return { markdown: '', used: [] };
  const used: KnowledgeUsed[] = [];
  let markdown = HEADER;
  for (const [index, doc] of documents.entries()) {
    const heading = `\n\n### ${doc.title}\n\n`;
    const part = heading + doc.body.trim();
    if (markdown.length + part.length <= budget) {
      markdown += part;
      used.push({ id: doc.id, title: doc.title, truncated: false });
      continue;
    }
    const more = documents.length - index - 1;
    const others = more ? `, ${String(more)} more document${more === 1 ? '' : 's'}` : '';
    const note = (omitted: string) =>
      `\n\n[Knowledge truncated to keep prompts bounded. Omitted: ${omitted}${others}.]`;
    const partial = note(`the rest of "${doc.title}"`);
    const room = budget - markdown.length - partial.length;
    if (room >= heading.length + 200) {
      markdown += part.slice(0, room) + partial;
      used.push({ id: doc.id, title: doc.title, truncated: true });
    } else {
      markdown += note(`"${doc.title}"`);
    }
    break;
  }
  return { markdown, used };
}

/**
 * Team knowledge base (V4): documents every agent must follow. Plain CRUD with optimistic
 * concurrency on `updatedAt`; enabled documents are appended to the agents' context on each run.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    if (!auth.organizationId) throw new BadRequestException('Select a team first');
    return {
      organizationId: auth.organizationId,
      userId: auth.userId,
      platformAdmin: auth.platformAdmin,
    };
  }

  private async load(tx: Database, id?: string): Promise<KnowledgeDocument[]> {
    const creator = alias(users, 'creator');
    const updater = alias(users, 'updater');
    const rows = await tx
      .select({
        doc: knowledgeDocuments,
        createdByName: creator.displayName,
        updatedByName: updater.displayName,
      })
      .from(knowledgeDocuments)
      .leftJoin(creator, eq(creator.id, knowledgeDocuments.createdBy))
      .leftJoin(updater, eq(updater.id, knowledgeDocuments.updatedBy))
      .where(id ? eq(knowledgeDocuments.id, id) : undefined)
      .orderBy(asc(knowledgeDocuments.createdAt), asc(knowledgeDocuments.id));
    return rows.map(({ doc, createdByName, updatedByName }) => ({
      id: doc.id,
      title: doc.title,
      body: doc.body,
      enabled: doc.enabled,
      createdAt: doc.createdAt.toISOString(),
      createdByName,
      updatedAt: doc.updatedAt.toISOString(),
      updatedByName,
    }));
  }

  private async one(tx: Database, id: string): Promise<KnowledgeDocument> {
    const [doc] = await this.load(tx, id);
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  list(auth: AuthContext): Promise<KnowledgeDocument[]> {
    return withDbContext(this.db, this.ctx(auth), (tx) => this.load(tx));
  }

  create(auth: AuthContext, input: CreateKnowledgeDocument, correlationId: string) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      // Serialises creates per team so the document limit holds.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge:${ctx.organizationId}`}, 0))`,
      );
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(knowledgeDocuments);
      if ((count?.n ?? 0) >= KNOWLEDGE_MAX_DOCUMENTS)
        throw conflict(
          'KNOWLEDGE_LIMIT',
          `A team can keep up to ${String(KNOWLEDGE_MAX_DOCUMENTS)} knowledge documents.`,
        );
      // Millisecond timestamps: `updatedAt` round-trips exactly through JSON for concurrency checks.
      const now = sql`date_trunc('milliseconds', now())`;
      const [row] = await tx
        .insert(knowledgeDocuments)
        .values({
          organizationId: ctx.organizationId,
          title: input.title,
          body: input.body,
          enabled: input.enabled ?? true,
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: knowledgeDocuments.id });
      if (!row) throw new Error('Knowledge insert returned no row');
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'knowledge.created',
        targetType: 'knowledge_document',
        targetId: row.id,
        correlationId,
        metadata: { title: input.title, enabled: input.enabled ?? true, length: input.body.length },
      });
      return this.one(tx, row.id);
    });
  }

  update(auth: AuthContext, id: string, input: UpdateKnowledgeDocument, correlationId: string) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const [current] = await tx
        .select({ updatedAt: knowledgeDocuments.updatedAt })
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, id))
        .for('update');
      if (!current) throw new NotFoundException('Document not found');
      if (current.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt))
        throw conflict('STALE_UPDATE', 'Someone saved this document after you opened it. Reload.');
      await tx
        .update(knowledgeDocuments)
        .set({
          title: input.title,
          body: input.body,
          enabled: input.enabled,
          updatedBy: auth.userId,
          // Strictly increasing, so two saves in the same millisecond still conflict.
          updatedAt: sql`greatest(date_trunc('milliseconds', now()), ${knowledgeDocuments.updatedAt} + interval '1 millisecond')`,
        })
        .where(eq(knowledgeDocuments.id, id));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'knowledge.updated',
        targetType: 'knowledge_document',
        targetId: id,
        correlationId,
        metadata: { title: input.title, enabled: input.enabled, length: input.body.length },
      });
      return this.one(tx, id);
    });
  }

  remove(auth: AuthContext, id: string, correlationId: string): Promise<void> {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const [row] = await tx
        .delete(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, id))
        .returning({ title: knowledgeDocuments.title });
      if (!row) throw new NotFoundException('Document not found');
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'knowledge.deleted',
        targetType: 'knowledge_document',
        targetId: id,
        correlationId,
        metadata: { title: row.title },
      });
    });
  }

  /** Enabled documents as the agents' `## Team knowledge` section. Runs inside the caller's tx. */
  async forAgents(tx: Database): Promise<{ markdown: string; used: KnowledgeUsed[] }> {
    const docs = await tx
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        body: knowledgeDocuments.body,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.enabled, true))
      .orderBy(asc(knowledgeDocuments.createdAt), asc(knowledgeDocuments.id));
    return knowledgeSection(docs);
  }
}
