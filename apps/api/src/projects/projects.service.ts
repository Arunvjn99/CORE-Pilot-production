import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Checkpoint,
  CreatePage,
  ProjectRepository,
  CreateProject,
  Project,
  ProjectPage,
  ProjectStatus,
  UpdatePage,
  UpdateProject,
} from '@core-studio/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pageFilePath } from '@core-studio/project-template';
import { AuditService } from '../audit/audit.service.js';
import { type RepoActor, RepositoriesService } from '../repositories/repositories.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { projectPages, projects, users } from '../db/schema.js';

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
  createdByName: users.displayName,
  pageCount: sql<number>`(select count(*)::int from ${projectPages} p where p.project_id = ${projects.id})`,
};

type ProjectRow = {
  [K in keyof typeof projectColumns]: K extends 'createdAt' | 'updatedAt'
    ? Date
    : K extends 'lastOpenedAt'
      ? Date | null
      : K extends 'createdByName'
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

  list(auth: AuthContext, status: ProjectStatus): Promise<Project[]> {
    return this.run(auth, async (tx) => {
      const rows = await tx
        .select(projectColumns)
        .from(projects)
        .leftJoin(users, eq(users.id, projects.createdBy))
        .where(eq(projects.status, status))
        .orderBy(desc(projects.updatedAt));
      return rows.map(toProject);
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
        const [row] = await tx
          .insert(projects)
          .values({
            organizationId,
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
          metadata: { name: input.name },
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
        const renaming = input.name !== undefined || input.description !== undefined;
        if (current.status === 'archived' && renaming && input.status !== 'active')
          throw conflict('PROJECT_ARCHIVED', 'Restore the project before editing it.');
        await tx
          .update(projects)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            updatedAt: sql`now()`,
          })
          .where(eq(projects.id, id));
        const action =
          input.status && input.status !== current.status
            ? input.status === 'archived'
              ? 'project.archived'
              : 'project.restored'
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
