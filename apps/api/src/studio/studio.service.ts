import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProjectDesign, ScreensResponse, SourceEdit } from '@core-studio/contracts';
import { pageFilePath, parseManifest } from '@core-studio/project-template';
import { DEFAULT_DESIGN_SYSTEM } from '@core-studio/studio-library';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { projectPages, projects } from '../db/schema.js';
import { type RepoActor, RepositoriesService } from '../repositories/repositories.service.js';
import { LibraryService } from './library.service.js';
import { applySourceEdit, SourceEditError } from './source-edit.js';

export const DESIGN_MD_PATH = 'DESIGN.md';
export const TOKENS_PATH = 'src/styles/tokens.css';

const conflict = (code: string, message: string) => new ConflictException({ code, message });

/** Project-level studio operations: screens for the canvas, the project's DESIGN.md, source edits. */
@Injectable()
export class StudioService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositories: RepositoriesService,
    private readonly library: LibraryService,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return this.library.ctx(auth);
  }

  private actor(auth: AuthContext, organizationId: string): RepoActor {
    return { userId: auth.userId, organizationId };
  }

  /** Locks project row + repository; refuses writes on archived projects. */
  async lockProject(tx: Database, projectId: string, requireActive: boolean) {
    const [row] = await tx
      .select({ status: projects.status, designSystemSlug: projects.designSystemSlug })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!row) throw new NotFoundException('Project not found');
    if (requireActive && row.status !== 'active')
      throw conflict('PROJECT_ARCHIVED', 'Restore the project before changing it.');
    await this.repositories.lock(tx, projectId);
    return row;
  }

  /** All screens (page components) with their code and the project tokens, for the canvas. */
  screens(auth: AuthContext, projectId: string): Promise<ScreensResponse> {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      await this.lockProject(tx, projectId, false);
      const actor = this.actor(auth, ctx.organizationId);
      const manifest = await this.repositories.ensureReady(tx, actor, projectId);
      const pages = await tx
        .select({ id: projectPages.id, name: projectPages.name, route: projectPages.route })
        .from(projectPages)
        .where(eq(projectPages.projectId, projectId))
        .orderBy(asc(projectPages.position));
      const byId = new Map(manifest.pages.map((p) => [p.id, p]));
      const screens = [];
      for (const page of pages) {
        const entry = byId.get(page.id);
        if (!entry) continue;
        const filePath = pageFilePath(entry);
        const code = await this.repositories.readFile(actor, projectId, filePath);
        if (code !== null)
          screens.push({ pageId: page.id, name: page.name, route: page.route, filePath, code });
      }
      return {
        revision: await this.repositories.revision(tx, projectId),
        tokensCss: (await this.repositories.readFile(actor, projectId, TOKENS_PATH)) ?? '',
        screens,
      };
    });
  }

  private async readDesign(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    slug: string | null,
  ): Promise<ProjectDesign> {
    return {
      designSystemSlug: slug,
      designMd: (await this.repositories.readFile(actor, projectId, DESIGN_MD_PATH)) ?? '',
      tokensCss: (await this.repositories.readFile(actor, projectId, TOKENS_PATH)) ?? '',
      revision: await this.repositories.revision(tx, projectId),
    };
  }

  design(auth: AuthContext, projectId: string): Promise<ProjectDesign> {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const project = await this.lockProject(tx, projectId, false);
      const actor = this.actor(auth, ctx.organizationId);
      await this.repositories.ensureReady(tx, actor, projectId);
      return this.readDesign(
        tx,
        actor,
        projectId,
        project.designSystemSlug ?? DEFAULT_DESIGN_SYSTEM,
      );
    });
  }

  /** Copies a team design system (current version) into the project's DESIGN.md and tokens.css. */
  applyDesignSystem(
    auth: AuthContext,
    projectId: string,
    slug: string,
    correlationId: string,
  ): Promise<ProjectDesign> {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      await this.lockProject(tx, projectId, true);
      const system = await this.library.resolveSystem(tx, slug);
      const actor = this.actor(auth, ctx.organizationId);
      await this.repositories.writeFiles(tx, actor, projectId, [
        { path: DESIGN_MD_PATH, content: system.designMd },
        { path: TOKENS_PATH, content: system.tokensCss },
      ]);
      await tx
        .update(projects)
        .set({ designSystemSlug: slug, updatedAt: sql`now()` })
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'project.design_system_applied',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { slug, version: system.version },
      });
      return this.readDesign(tx, actor, projectId, slug);
    });
  }

  updateDesign(
    auth: AuthContext,
    projectId: string,
    input: { designMd: string; tokensCss: string; baseRevision: number },
    correlationId: string,
  ): Promise<ProjectDesign> {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const project = await this.lockProject(tx, projectId, true);
      const actor = this.actor(auth, ctx.organizationId);
      await this.repositories.writeFiles(
        tx,
        actor,
        projectId,
        [
          { path: DESIGN_MD_PATH, content: input.designMd },
          { path: TOKENS_PATH, content: input.tokensCss },
        ],
        input.baseRevision,
      );
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'project.design_updated',
        targetType: 'project',
        targetId: projectId,
        correlationId,
      });
      return this.readDesign(tx, actor, projectId, project.designSystemSlug);
    });
  }

  /** Visual edit from the canvas/right panel → precise change to the screen's source. */
  editSource(auth: AuthContext, projectId: string, edit: SourceEdit, correlationId: string) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      await this.lockProject(tx, projectId, true);
      const actor = this.actor(auth, ctx.organizationId);
      const manifest = await this.repositories.ensureReady(tx, actor, projectId);
      // Only page components (screens) are edited from the canvas.
      if (!manifest.pages.some((p) => pageFilePath(p) === edit.path))
        throw new BadRequestException('Only screen files can be edited from the canvas');
      const code = await this.repositories.readFile(actor, projectId, edit.path);
      if (code === null) throw new NotFoundException('Screen not found');
      let next: string;
      try {
        next = applySourceEdit(code, edit);
      } catch (error) {
        if (error instanceof SourceEditError) throw conflict(`EDIT_${error.code}`, error.message);
        throw error;
      }
      const revision = await this.repositories.writeFiles(
        tx,
        actor,
        projectId,
        [{ path: edit.path, content: next }],
        edit.baseRevision,
      );
      await tx
        .update(projects)
        .set({ updatedAt: sql`now()` })
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'screen.edited',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { path: edit.path, op: edit.op.type },
      });
      return { revision, code: next };
    });
  }

  /** Current manifest page names/routes (for run context). */
  async manifestPages(tx: Database, actor: RepoActor, projectId: string) {
    return parseManifest(JSON.stringify(await this.repositories.ensureReady(tx, actor, projectId)))
      .pages;
  }
}
