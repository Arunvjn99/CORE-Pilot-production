import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Checkpoint,
  CreatePage,
  ProjectRepository,
  CreateProject,
  Project,
  ProjectPage,
  ProjectListQuery,
  ProjectStatus,
  UpdatePage,
  UpdateProject,
} from '@core-studio/contracts';
import { and, asc, desc, eq, ilike, isNull, type SQL, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pageFilePath } from '@core-studio/project-template';
import { AuditService } from '../audit/audit.service.js';
import { type RepoActor, RepositoriesService } from '../repositories/repositories.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { folders, projectPages, projects, users } from '../db/schema.js';

const UNIQUE_VIOLATION = '23505';

function uniqueViolation(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === UNIQUE_VIOLATION) return typeof e.constraint === 'string' ? e.constraint : '';
    current = e.cause;
  }
  return null;
}

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const stale = () =>
  conflict('STALE_UPDATE', 'Someone else changed this in the meantime. Reload and try again.');

const projectColumns = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  status: projects.status,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  lastOpenedAt: projects.lastOpenedAt,
  folderId: projects.folderId,
  folderName: folders.name,
  designSystemSlug: projects.designSystemSlug,
  createdByName: users.displayName,
  pageCount: sql<number>`(select count(*)::int from ${projectPages} p where p.project_id = ${projects.id})`,
};

type ProjectRow = {
  [K in keyof typeof projectColumns]: K extends 'createdAt' | 'updatedAt'
    ? Date
    : K extends 'lastOpenedAt'
      ? Date | null
      : K extends 'createdByName' | 'folderId' | 'folderName' | 'designSystemSlug'
        ? string | null
        : K extends 'pageCount'
          ? number
          : K extends 'status'
            ? ProjectStatus
            : string;
};

const toProject = (row: ProjectRow): Project => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  lastOpenedAt: row.lastOpenedAt ? row.lastOpenedAt.toISOString() : null,
});

const toPage = (row: typeof projectPages.$inferSelect): ProjectPage => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  route: row.route,
  position: row.position,
  filePath: row.filePath,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Projects and pages of the active team. RLS scopes every query to that team. */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly repositories: RepositoriesService,
  ) {}

  private ctx(auth: AuthContext) {
    if (!auth.organizationId) throw new ForbiddenException('Select a team first');
    return {
      organizationId: auth.organizationId,
      userId: auth.userId,
      platformAdmin: auth.platformAdmin,
    };
  }

  private run<T>(auth: AuthContext, fn: (tx: Database, organizationId: string) => Promise<T>) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, (tx) => fn(tx, ctx.organizationId));
  }

  private async loadProject(tx: Database, id: string): Promise<Project> {
    const [row] = await tx
      .select(projectColumns)
      .from(projects)
      .leftJoin(users, eq(users.id, projects.createdBy))
      .leftJoin(folders, eq(folders.id, projects.folderId))
      .where(eq(projects.id, id));
    if (!row) throw new NotFoundException('Project not found');
    return toProject(row);
  }

  /** Locks the project row; page changes on archived projects are refused. */
  private async lockActiveProject(tx: Database, id: string) {
    const [row] = await tx
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, id))
      .for('update');
    if (!row) throw new NotFoundException('Project not found');
    if (row.status !== 'active')
      throw conflict('PROJECT_ARCHIVED', 'Restore the project before changing its pages.');
  }

  private touch(tx: Database, id: string) {
    return tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, id));
  }

  /** Files of the team: by status, project (folder) or Drafts, name search and sort. */
  list(auth: AuthContext, query: ProjectListQuery): Promise<Project[]> {
    return this.run(auth, async (tx) => {
      const filters: SQL[] = [eq(projects.status, query.status)];
      if (query.folder === 'drafts') filters.push(isNull(projects.folderId));
      else if (query.folder) filters.push(eq(projects.folderId, query.folder));
      if (query.q) filters.push(ilike(projects.name, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`));
      const order = {
        updated: [desc(projects.updatedAt)],
        opened: [sql`${projects.lastOpenedAt} desc nulls last`, desc(projects.updatedAt)],
        name: [asc(sql`lower(${projects.name})`)],
        created: [desc(projects.createdAt)],
      }[query.sort];
      const rows = await tx
        .select(projectColumns)
        .from(projects)
        .leftJoin(users, eq(users.id, projects.createdBy))
        .leftJoin(folders, eq(folders.id, projects.folderId))
        .where(and(...filters))
        .orderBy(...order, desc(projects.id))
        .limit(500);
      return rows.map(toProject);
    });
  }

  /** A folder id from the client must name a project of the caller's team (RLS-scoped read). */
  private async assertFolder(tx: Database, folderId: string | null) {
    if (!folderId) return;
    const [row] = await tx.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId));
    if (!row)
      throw new NotFoundException({
        code: 'FOLDER_NOT_FOUND',
        message: 'This project no longer exists.',
      });
  }

  get(auth: AuthContext, id: string): Promise<Project> {
    return this.run(auth, (tx) => this.loadProject(tx, id));
  }

  /** Records that the user opened the project (drives "Recent projects"); not an edit. */
  open(auth: AuthContext, id: string): Promise<Project> {
    return this.run(auth, async (tx) => {
      const updated = await tx
        .update(projects)
        .set({ lastOpenedAt: sql`now()` })
        .where(eq(projects.id, id))
        .returning({ id: projects.id });
      if (updated.length === 0) throw new NotFoundException('Project not found');
      return this.loadProject(tx, id);
    });
  }

  async create(auth: AuthContext, input: CreateProject, correlationId: string): Promise<Project> {
    try {
      return await this.run(auth, async (tx, organizationId) => {
        await this.assertFolder(tx, input.folderId);
        const [row] = await tx
          .insert(projects)
          .values({
            organizationId,
            folderId: input.folderId,
            name: input.name,
            description: input.description,
            createdBy: auth.userId,
            lastOpenedAt: sql`now()`,
          })
          .returning({ id: projects.id });
        if (!row) throw new Error('Insert returned no row');
        await this.repositories.lock(tx, row.id);
        await this.repositories.initialize(tx, this.actor(auth, organizationId), row.id, [
          { id: randomUUID(), name: 'Home', route: '/' },
        ]);
        await this.audit.record(tx, {
          organizationId,
          actorId: auth.userId,
          action: 'project.created',
          targetType: 'project',
          targetId: row.id,
          correlationId,
          metadata: { name: input.name, folderId: input.folderId },
        });
        return this.loadProject(tx, row.id);
      });
    } catch (error) {
      if (uniqueViolation(error) !== null)
        throw conflict('NAME_TAKEN', 'A project with this name already exists in this team.');
      throw error;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateProject,
    correlationId: string,
  ): Promise<Project> {
    try {
      return await this.run(auth, async (tx, organizationId) => {
        const [current] = await tx
          .select({ status: projects.status, updatedAt: projects.updatedAt })
          .from(projects)
          .where(eq(projects.id, id))
          .for('update');
        if (!current) throw new NotFoundException('Project not found');
        if (current.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString())
          throw stale();
        const renaming =
          input.name !== undefined ||
          input.description !== undefined ||
          input.folderId !== undefined;
        if (input.folderId !== undefined) await this.assertFolder(tx, input.folderId);
        if (current.status === 'archived' && renaming && input.status !== 'active')
          throw conflict('PROJECT_ARCHIVED', 'Restore the project before editing it.');
        await tx
          .update(projects)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
            updatedAt: sql`now()`,
          })
          .where(eq(projects.id, id));
        const action =
          input.status && input.status !== current.status
            ? input.status === 'archived'
              ? 'project.archived'
              : 'project.restored'
            : input.folderId !== undefined && input.name === undefined
              ? 'project.moved'
              : 'project.updated';
        await this.audit.record(tx, {
          organizationId,
          actorId: auth.userId,
          action,
          targetType: 'project',
          targetId: id,
          correlationId,
          metadata: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { descriptionChanged: true } : {}),
            ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          },
        });
        return this.loadProject(tx, id);
      });
    } catch (error) {
      if (uniqueViolation(error) !== null)
        throw conflict('NAME_TAKEN', 'A project with this name already exists in this team.');
      throw error;
    }
  }

  /**
   * Copies a file: same project, description and design system; the repository is copied with its
   * history and checkpoints; screens get new ids. Name defaults to "<name> (copy)", made unique.
   */
  async duplicate(
    auth: AuthContext,
    id: string,
    name: string | undefined,
    correlationId: string,
  ): Promise<Project> {
    try {
      return await this.run(auth, async (tx, organizationId) => {
        await this.lockActiveProject(tx, id);
        const [full] = await tx.select().from(projects).where(eq(projects.id, id));
        if (!full) throw new NotFoundException('Project not found');
        const taken = new Set(
          (
            await tx
              .select({ name: sql<string>`lower(${projects.name})` })
              .from(projects)
              .where(eq(projects.status, 'active'))
          ).map((r) => r.name),
        );
        let finalName = name ?? '';
        if (!finalName)
          for (let n = 1; ; n += 1) {
            const suffix = n === 1 ? ' (copy)' : ` (copy ${String(n)})`;
            finalName = `${full.name.slice(0, 80 - suffix.length)}${suffix}`;
            if (!taken.has(finalName.toLowerCase())) break;
          }
        const [row] = await tx
          .insert(projects)
          .values({
            organizationId,
            folderId: full.folderId,
            name: finalName,
            description: full.description,
            designSystemSlug: full.designSystemSlug,
            createdBy: auth.userId,
            lastOpenedAt: sql`now()`,
          })
          .returning({ id: projects.id });
        if (!row) throw new Error('Insert returned no row');
        await this.repositories.lock(tx, id);
        await this.repositories.lock(tx, row.id);
        await this.repositories.duplicate(
          tx,
          this.actor(auth, organizationId),
          id,
          row.id,
          `Duplicate of "${full.name.slice(0, 120)}"`,
        );
        await this.audit.record(tx, {
          organizationId,
          actorId: auth.userId,
          action: 'project.duplicated',
          targetType: 'project',
          targetId: row.id,
          correlationId,
          metadata: { sourceId: id, name: finalName },
        });
        return this.loadProject(tx, row.id);
      });
    } catch (error) {
      if (uniqueViolation(error) !== null)
        throw conflict('NAME_TAKEN', 'A project with this name already exists in this team.');
      throw error;
    }
  }

  // ---------- delete forever (Trash) ----------

  /**
   * Deletes trashed files in the caller's team through the SECURITY DEFINER function
   * `purge_trashed_project` (checkpoints are append-only for the app role, ADR-0012). Rows are
   * locked in id order, then each repository lock, so writers of the same file are serialised.
   */
  private async purge(
    tx: Database,
    auth: AuthContext,
    organizationId: string,
    files: { id: string; name: string }[],
    correlationId: string,
    via: 'file' | 'empty_trash',
  ) {
    for (const file of files) {
      await this.repositories.lock(tx, file.id);
      const result = await tx.execute<{ result: string }>(
        sql`select purge_trashed_project(${file.id}::uuid) as result`,
      );
      const outcome = result.rows[0]?.result;
      if (outcome === 'not_found') throw new NotFoundException('Project not found');
      if (outcome !== 'deleted')
        throw conflict('NOT_IN_TRASH', 'Move the file to Trash before deleting it forever.');
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'project.deleted_permanently',
        targetType: 'project',
        targetId: file.id,
        correlationId,
        metadata: { name: file.name, via },
      });
    }
  }

  /** Repository and bundles go after commit; a failure leaves only unreachable files behind. */
  private async removeFiles(organizationId: string, ids: string[]) {
    for (const id of ids)
      try {
        await this.repositories.removeFiles(organizationId, id);
      } catch (error) {
        this.logger.error({ err: error, projectId: id }, 'Removing repository files failed');
      }
  }

  /** Permanently deletes one file that is already in Trash (team admins and owners). */
  async deleteForever(auth: AuthContext, id: string, correlationId: string): Promise<void> {
    const { organizationId } = this.ctx(auth);
    await this.run(auth, async (tx) => {
      const [row] = await tx
        .select({ id: projects.id, name: projects.name, status: projects.status })
        .from(projects)
        .where(eq(projects.id, id))
        .for('update');
      if (!row) throw new NotFoundException('Project not found');
      if (row.status !== 'archived')
        throw conflict('NOT_IN_TRASH', 'Move the file to Trash before deleting it forever.');
      await this.purge(tx, auth, organizationId, [row], correlationId, 'file');
    });
    await this.removeFiles(organizationId, [id]);
  }

  /** Permanently deletes every file in the team's Trash. */
  async emptyTrash(auth: AuthContext, correlationId: string): Promise<{ deleted: number }> {
    const { organizationId } = this.ctx(auth);
    const ids = await this.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.status, 'archived'))
        .orderBy(asc(projects.id))
        .for('update');
      await this.purge(tx, auth, organizationId, rows, correlationId, 'empty_trash');
      return rows.map((r) => r.id);
    });
    await this.removeFiles(organizationId, ids);
    return { deleted: ids.length };
  }

  // ---------- pages (repository-backed: PROJECT_REPOSITORY_DESIGN.md §4) ----------

  /** Row lock on the project, then the per-project repository lock; same order everywhere. */
  private async lockRepository(tx: Database, projectId: string, requireActive: boolean) {
    if (requireActive) await this.lockActiveProject(tx, projectId);
    else await this.loadProject(tx, projectId);
    await this.repositories.lock(tx, projectId);
  }

  private actor(auth: AuthContext, organizationId: string): RepoActor {
    return { userId: auth.userId, organizationId };
  }

  private async pageRow(tx: Database, projectId: string, pageId: string): Promise<ProjectPage> {
    const [row] = await tx
      .select()
      .from(projectPages)
      .where(and(eq(projectPages.id, pageId), eq(projectPages.projectId, projectId)));
    if (!row) throw new NotFoundException('Page not found');
    return toPage(row);
  }

  listPages(auth: AuthContext, projectId: string): Promise<ProjectPage[]> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, false);
      await this.repositories.ensureReady(tx, this.actor(auth, organizationId), projectId);
      const rows = await tx
        .select()
        .from(projectPages)
        .where(eq(projectPages.projectId, projectId))
        .orderBy(asc(projectPages.position), asc(projectPages.createdAt));
      return rows.map(toPage);
    });
  }

  createPage(
    auth: AuthContext,
    projectId: string,
    input: CreatePage,
    correlationId: string,
  ): Promise<ProjectPage> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, true);
      const page = await this.repositories.createPage(
        tx,
        this.actor(auth, organizationId),
        projectId,
        input,
      );
      await tx
        .update(projectPages)
        .set({ createdBy: auth.userId })
        .where(eq(projectPages.id, page.id));
      await this.touch(tx, projectId);
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'page.created',
        targetType: 'project_page',
        targetId: page.id,
        correlationId,
        metadata: { projectId, name: input.name, route: input.route, file: pageFilePath(page) },
      });
      return this.pageRow(tx, projectId, page.id);
    });
  }

  updatePage(
    auth: AuthContext,
    projectId: string,
    pageId: string,
    input: UpdatePage,
    correlationId: string,
  ): Promise<ProjectPage> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, true);
      const actor = this.actor(auth, organizationId);
      await this.repositories.ensureReady(tx, actor, projectId);
      const current = await this.pageRow(tx, projectId, pageId);
      if (current.updatedAt !== new Date(input.expectedUpdatedAt).toISOString()) throw stale();
      await this.repositories.updatePage(tx, actor, projectId, pageId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.route !== undefined ? { route: input.route } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      });
      await this.touch(tx, projectId);
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'page.updated',
        targetType: 'project_page',
        targetId: pageId,
        correlationId,
        metadata: {
          projectId,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.route !== undefined ? { route: input.route } : {}),
        },
      });
      return this.pageRow(tx, projectId, pageId);
    });
  }

  deletePage(
    auth: AuthContext,
    projectId: string,
    pageId: string,
    correlationId: string,
  ): Promise<void> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, true);
      const deleted = await this.repositories.deletePage(
        tx,
        this.actor(auth, organizationId),
        projectId,
        pageId,
      );
      await this.touch(tx, projectId);
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'page.deleted',
        targetType: 'project_page',
        targetId: pageId,
        correlationId,
        metadata: {
          projectId,
          name: deleted.name,
          route: deleted.route,
          file: pageFilePath(deleted),
        },
      });
    });
  }

  // ---------- repository and checkpoints ----------

  repository(auth: AuthContext, projectId: string): Promise<ProjectRepository> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, false);
      return this.repositories.describe(tx, this.actor(auth, organizationId), projectId);
    });
  }

  listCheckpoints(auth: AuthContext, projectId: string, limit: number): Promise<Checkpoint[]> {
    return this.run(auth, async (tx) => {
      await this.loadProject(tx, projectId);
      const rows = await this.repositories.listCheckpoints(tx, projectId, limit);
      return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    });
  }

  createCheckpoint(
    auth: AuthContext,
    projectId: string,
    message: string,
    correlationId: string,
  ): Promise<Checkpoint> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, true);
      const row = await this.repositories.checkpoint(
        tx,
        this.actor(auth, organizationId),
        projectId,
        message,
        'manual',
      );
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'checkpoint.created',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { checkpointId: row.id, commit: row.commitSha },
      });
      return this.checkpointById(tx, projectId, row.id);
    });
  }

  /** Builds the project ZIP; the caller streams `file` and then calls `cleanup()`. */
  exportProject(
    auth: AuthContext,
    projectId: string,
    checkpointId: string | null,
    correlationId: string,
  ) {
    return this.run(auth, async (tx, organizationId) => {
      const project = await this.loadProject(tx, projectId);
      await this.repositories.lock(tx, projectId);
      const slug =
        project.name
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60)
          .replace(/-+$/, '') || 'project';
      const archive = await this.repositories.exportArchive(
        tx,
        this.actor(auth, organizationId),
        projectId,
        checkpointId,
        slug,
      );
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'project.exported',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { checkpointId, source: archive.source },
      });
      return { ...archive, filename: `${slug}.zip` };
    });
  }

  restoreCheckpoint(
    auth: AuthContext,
    projectId: string,
    checkpointId: string,
    safetyCheckpoint: boolean,
    correlationId: string,
  ): Promise<Checkpoint> {
    return this.run(auth, async (tx, organizationId) => {
      await this.lockRepository(tx, projectId, true);
      const row = await this.repositories.restore(
        tx,
        this.actor(auth, organizationId),
        projectId,
        checkpointId,
        { safetyCheckpoint },
      );
      await this.touch(tx, projectId);
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'checkpoint.restored',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { restoredFrom: checkpointId, checkpointId: row.id, commit: row.commitSha },
      });
      return this.checkpointById(tx, projectId, row.id);
    });
  }

  private async checkpointById(tx: Database, projectId: string, id: string): Promise<Checkpoint> {
    const rows = await this.repositories.listCheckpoints(tx, projectId, 200);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException('Checkpoint not found');
    return { ...row, createdAt: row.createdAt.toISOString() };
  }
}
