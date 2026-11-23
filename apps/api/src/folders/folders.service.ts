import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Folder } from '@core-studio/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { folders, projects } from '../db/schema.js';

const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; cause?: unknown };
    if (e.code === UNIQUE_VIOLATION) return true;
    current = e.cause;
  }
  return false;
};
const nameTaken = () =>
  new ConflictException({
    code: 'NAME_TAKEN',
    message: 'A project with this name already exists.',
  });

const columns = {
  id: folders.id,
  name: folders.name,
  createdAt: folders.createdAt,
  updatedAt: folders.updatedAt,
  fileCount: sql<number>`(select count(*)::int from ${projects} f where f.folder_id = "folders"."id" and f.status = 'active')`,
};

const toFolder = (row: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  fileCount: number;
}): Folder => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** What the UI calls "Projects": folders of files in the active team (ADR-0014). RLS-scoped. */
@Injectable()
export class FoldersService {
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

  private async load(tx: Database, id: string): Promise<Folder> {
    const [row] = await tx.select(columns).from(folders).where(eq(folders.id, id));
    if (!row) throw new NotFoundException('Project not found');
    return toFolder(row);
  }

  list(auth: AuthContext): Promise<Folder[]> {
    return this.run(auth, async (tx) =>
      (
        await tx
          .select(columns)
          .from(folders)
          .orderBy(asc(sql`lower(${folders.name})`))
      ).map(toFolder),
    );
  }

  async create(auth: AuthContext, name: string, correlationId: string): Promise<Folder> {
    try {
      return await this.run(auth, async (tx, organizationId) => {
        const [row] = await tx
          .insert(folders)
          .values({ organizationId, name, createdBy: auth.userId })
          .returning({ id: folders.id });
        if (!row) throw new Error('Insert returned no row');
        await this.audit.record(tx, {
          organizationId,
          actorId: auth.userId,
          action: 'folder.created',
          targetType: 'folder',
          targetId: row.id,
          correlationId,
          metadata: { name },
        });
        return this.load(tx, row.id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async rename(auth: AuthContext, id: string, name: string, correlationId: string) {
    try {
      return await this.run(auth, async (tx, organizationId) => {
        const updated = await tx
          .update(folders)
          .set({ name, updatedAt: sql`now()` })
          .where(eq(folders.id, id))
          .returning({ id: folders.id });
        if (updated.length === 0) throw new NotFoundException('Project not found');
        await this.audit.record(tx, {
          organizationId,
          actorId: auth.userId,
          action: 'folder.renamed',
          targetType: 'folder',
          targetId: id,
          correlationId,
          metadata: { name },
        });
        return this.load(tx, id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  /** Moves the project's active files to Trash, then deletes it (trashed files fall to Drafts). */
  remove(auth: AuthContext, id: string, correlationId: string) {
    return this.run(auth, async (tx, organizationId) => {
      const [folder] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.id, id))
        .for('update');
      if (!folder) throw new NotFoundException('Project not found');
      const trashed = await tx
        .update(projects)
        .set({ status: 'archived', updatedAt: sql`now()` })
        .where(and(eq(projects.folderId, id), eq(projects.status, 'active')))
        .returning({ id: projects.id });
      await tx.delete(folders).where(eq(folders.id, id));
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'folder.deleted',
        targetType: 'folder',
        targetId: id,
        correlationId,
        metadata: { trashedFiles: trashed.map((f) => f.id) },
      });
      return { trashedFiles: trashed.length };
    });
  }
}
