import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  componentNameFor,
  type Manifest,
  type ManifestPage,
  MANIFEST_PATH,
  pageFilePath,
  parseManifest,
  renderManifest,
  renderPageStub,
  renderProject,
  renderRoutes,
  ROUTES_PATH,
  TEMPLATE_VERSION,
  uniqueFolder,
} from '@core-studio/project-template';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/database.js';
import { projectCheckpoints, projectPages, projectRepositories, users } from '../db/schema.js';
import { Git, type GitIdentity } from './git.js';
import { RepoFs } from './repo-fs.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMITTER: GitIdentity = { name: 'CORE Studio', email: 'noreply@core-studio.invalid' };
const REVISION_MARKER = 'core-revision';

export interface RepoActor {
  userId: string;
  organizationId: string;
}

export interface RepositoryState {
  status: 'initializing' | 'ready' | 'failed';
  templateVersion: string;
  workingRevision: number;
  headCommit: string | null;
}

export type CheckpointKind = 'create' | 'manual' | 'restore' | 'safety';

const conflict = (code: string, message: string) => new ConflictException({ code, message });

/**
 * One git repository per project (PROJECT_REPOSITORY_DESIGN.md). The repository is the source of
 * truth; `project_pages` is a projection rebuilt from `core.project.json`.
 *
 * Every method takes the caller's RLS-scoped transaction and must run after `lock()`, so that only
 * one writer touches a project's working tree at a time across all API replicas.
 */
@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  // ---------- locations ----------

  private projectDir(organizationId: string, projectId: string): string {
    if (!UUID.test(organizationId) || !UUID.test(projectId))
      throw new Error('Invalid repository id');
    return join(this.config.REPO_ROOT, organizationId, projectId);
  }

  private open(organizationId: string, projectId: string) {
    const dir = this.projectDir(organizationId, projectId);
    const root = join(dir, 'repo');
    return {
      dir,
      root,
      fs: new RepoFs(root, join(dir, 'tmp')),
      git: new Git(this.config.GIT_BINARY, root),
      marker: join(root, '.git', REVISION_MARKER),
    };
  }

  /** Serialises all writers of one project (advisory lock released at transaction end). */
  async lock(tx: Database, projectId: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`repo:${projectId}`}, 0))`,
    );
  }

  private async author(tx: Database, userId: string): Promise<GitIdentity> {
    const [row] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    // Never real email addresses in history: a non-routable per-user address.
    return {
      name: row?.name ?? 'CORE Studio user',
      email: `user-${userId}@users.core-studio.invalid`,
    };
  }

  private async readMarker(path: string): Promise<number | null> {
    try {
      const value = Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
      return Number.isSafeInteger(value) ? value : null;
    } catch {
      return null;
    }
  }

  private async state(tx: Database, projectId: string) {
    const [row] = await tx
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId));
    return row ?? null;
  }

  // ---------- lifecycle ----------

  /**
   * Creates the repository from the template with the given pages and records the first
   * checkpoint. Idempotent for a project whose previous attempt failed (the directory is rebuilt).
   */
  async initialize(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    pages: { id: string; name: string; route: string }[],
  ): Promise<Manifest> {
    const repo = this.open(actor.organizationId, projectId);
    try {
      await rm(repo.dir, { recursive: true, force: true });
      await mkdir(repo.root, { recursive: true });
      const { files, manifest } = await renderProject(pages);
      for (const [path, content] of files) await repo.fs.write(path, content, { managed: true });
      await repo.git.init();
      await repo.git.addAll();
      const sha = await repo.git.commit(
        'Create project',
        await this.author(tx, actor.userId),
        COMMITTER,
      );
      await writeFile(repo.marker, '1\n');

      const values = {
        organizationId: actor.organizationId,
        status: 'ready' as const,
        templateVersion: TEMPLATE_VERSION,
        headCommit: sha,
        workingRevision: 1,
        lastErrorCode: null,
        updatedAt: sql`now()`,
      };
      await tx
        .insert(projectRepositories)
        .values({ projectId, ...values })
        .onConflictDoUpdate({ target: projectRepositories.projectId, set: values });
      await this.syncPages(tx, actor.organizationId, projectId, manifest);
      await tx.insert(projectCheckpoints).values({
        projectId,
        organizationId: actor.organizationId,
        commitSha: sha,
        message: 'Create project',
        kind: 'create',
        revision: 1,
        authorId: actor.userId,
      });
      return manifest;
    } catch (error) {
      this.logger.error({ err: error, projectId }, 'Repository initialisation failed');
      await rm(repo.dir, { recursive: true, force: true }).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'REPOSITORY_UNAVAILABLE',
        message: 'The project repository could not be created. Try again.',
      });
    }
  }

  /**
   * Ensures the repository exists and the database projection matches it. Projects created before
   * repositories existed (slice 2.5) are initialised from their stored pages here (lazy backfill).
   */
  async ensureReady(tx: Database, actor: RepoActor, projectId: string): Promise<Manifest> {
    const row = await this.state(tx, projectId);
    if (row?.status !== 'ready') {
      const pages = await tx
        .select({ id: projectPages.id, name: projectPages.name, route: projectPages.route })
        .from(projectPages)
        .where(eq(projectPages.projectId, projectId))
        .orderBy(projectPages.position, projectPages.createdAt);
      return this.initialize(
        tx,
        actor,
        projectId,
        pages.length ? pages : [{ id: randomUUID(), name: 'Home', route: '/' }],
      );
    }
    const repo = this.open(actor.organizationId, projectId);
    const manifest = parseManifest(await repo.fs.readText(MANIFEST_PATH));
    const onDisk = await this.readMarker(repo.marker);
    if (onDisk !== row.workingRevision) {
      // A previous request changed files but its database transaction did not commit: the repository wins.
      this.logger.warn(
        { projectId, onDisk, db: row.workingRevision },
        'Reconciling page projection',
      );
      await this.syncPages(tx, actor.organizationId, projectId, manifest);
      await this.setRevision(
        tx,
        projectId,
        Math.max(onDisk ?? 0, row.workingRevision) + 1,
        repo.marker,
      );
    }
    return manifest;
  }

  private async setRevision(tx: Database, projectId: string, revision: number, marker: string) {
    await writeFile(marker, `${String(revision)}\n`);
    await tx
      .update(projectRepositories)
      .set({ workingRevision: revision, updatedAt: sql`now()` })
      .where(eq(projectRepositories.projectId, projectId));
  }

  private async bumpRevision(tx: Database, projectId: string, marker: string): Promise<number> {
    const [row] = await tx
      .select({ revision: projectRepositories.workingRevision })
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId));
    const next = (row?.revision ?? 0) + 1;
    await this.setRevision(tx, projectId, next, marker);
    return next;
  }

  /** Rebuilds `project_pages` from the manifest (ids, names, routes, order, files). */
  private async syncPages(
    tx: Database,
    organizationId: string,
    projectId: string,
    manifest: Manifest,
  ) {
    const ids = manifest.pages.map((p) => p.id);
    await tx
      .delete(projectPages)
      .where(and(eq(projectPages.projectId, projectId), notInArray(projectPages.id, ids)));
    // Pass 1: park changed routes on unique placeholders so swaps between pages never collide.
    for (const page of manifest.pages)
      await tx
        .update(projectPages)
        .set({ route: sql`'/__core_tmp_' || ${projectPages.id}::text` })
        .where(and(eq(projectPages.id, page.id), sql`${projectPages.route} <> ${page.route}`));
    // Pass 2: upsert the manifest state; only rows that actually change get a new updatedAt.
    for (const [position, page] of manifest.pages.entries()) {
      const values = { name: page.name, route: page.route, position, filePath: pageFilePath(page) };
      await tx
        .insert(projectPages)
        .values({ id: page.id, projectId, organizationId, ...values })
        .onConflictDoUpdate({
          target: projectPages.id,
          set: { ...values, updatedAt: sql`now()` },
          setWhere: sql`(${projectPages.name}, ${projectPages.route}, ${projectPages.position}, ${projectPages.filePath}) is distinct from (${page.name}::text, ${page.route}::text, ${position}::int, ${pageFilePath(page)}::text)`,
        });
    }
  }

  // ---------- pages ----------

  private async writeManifest(fs: RepoFs, manifest: Manifest) {
    await fs.write(MANIFEST_PATH, renderManifest(manifest), { managed: true });
    await fs.write(ROUTES_PATH, renderRoutes(manifest), { managed: true });
  }

  async createPage(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    input: { name: string; route: string },
  ): Promise<ManifestPage> {
    const manifest = await this.ensureReady(tx, actor, projectId);
    if (manifest.pages.some((p) => p.route === input.route))
      throw conflict('ROUTE_TAKEN', 'Another page in this project already uses this route.');
    const repo = this.open(actor.organizationId, projectId);
    const folder = uniqueFolder(
      input.name,
      manifest.pages.map((p) => p.folder),
    );
    const page: ManifestPage = {
      id: randomUUID(),
      name: input.name,
      route: input.route,
      folder,
      component: componentNameFor(folder),
    };
    if (await repo.fs.exists(`src/pages/${folder}`))
      throw conflict(
        'FOLDER_EXISTS',
        'A folder for this page already exists in the project source.',
      );
    await repo.fs.write(pageFilePath(page), renderPageStub(page));
    const next = { ...manifest, pages: [...manifest.pages, page] };
    await this.writeManifest(repo.fs, next);
    await this.syncPages(tx, actor.organizationId, projectId, next);
    await this.bumpRevision(tx, projectId, repo.marker);
    return page;
  }

  /** Renames, re-routes or reorders a page. The page folder and component name never change. */
  async updatePage(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    pageId: string,
    input: { name?: string; route?: string; position?: number },
  ): Promise<ManifestPage> {
    const manifest = await this.ensureReady(tx, actor, projectId);
    const current = manifest.pages.find((p) => p.id === pageId);
    if (!current) throw new NotFoundException('Page not found');
    if (
      input.route !== undefined &&
      manifest.pages.some((p) => p.id !== pageId && p.route === input.route)
    )
      throw conflict('ROUTE_TAKEN', 'Another page in this project already uses this route.');
    const updated: ManifestPage = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.route !== undefined ? { route: input.route } : {}),
    };
    const pages = manifest.pages.map((p) => (p.id === pageId ? updated : p));
    if (input.position !== undefined) {
      const from = pages.findIndex((p) => p.id === pageId);
      const [moved] = pages.splice(from, 1);
      if (moved) pages.splice(Math.min(input.position, pages.length), 0, moved);
    }
    const next = { ...manifest, pages };
    const repo = this.open(actor.organizationId, projectId);
    await this.writeManifest(repo.fs, next);
    await this.syncPages(tx, actor.organizationId, projectId, next);
    await this.bumpRevision(tx, projectId, repo.marker);
    return updated;
  }

  /** Deletes the page's folder (the page component and anything next to it) and its route. */
  async deletePage(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    pageId: string,
  ): Promise<ManifestPage> {
    const manifest = await this.ensureReady(tx, actor, projectId);
    const page = manifest.pages.find((p) => p.id === pageId);
    if (!page) throw new NotFoundException('Page not found');
    if (manifest.pages.length <= 1)
      throw conflict('LAST_PAGE', 'A project needs at least one page.');
    const repo = this.open(actor.organizationId, projectId);
    await repo.fs.removeTree(`src/pages/${page.folder}`);
    const next = { ...manifest, pages: manifest.pages.filter((p) => p.id !== pageId) };
    await this.writeManifest(repo.fs, next);
    await this.syncPages(tx, actor.organizationId, projectId, next);
    await this.bumpRevision(tx, projectId, repo.marker);
    return page;
  }

  // ---------- state, checkpoints, restore ----------

  async describe(
    tx: Database,
    actor: RepoActor,
    projectId: string,
  ): Promise<RepositoryState & { dirty: boolean }> {
    await this.ensureReady(tx, actor, projectId);
    const row = await this.state(tx, projectId);
    if (!row) throw new NotFoundException('Repository not found');
    const repo = this.open(actor.organizationId, projectId);
    return {
      status: row.status,
      templateVersion: row.templateVersion,
      workingRevision: row.workingRevision,
      headCommit: row.headCommit,
      dirty: await repo.git.hasChanges(),
    };
  }

  async checkpoint(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    message: string,
    kind: CheckpointKind,
    restoredFrom: string | null = null,
  ) {
    await this.ensureReady(tx, actor, projectId);
    const repo = this.open(actor.organizationId, projectId);
    const measured = await repo.fs.measure();
    if (measured.files > 2000 || measured.bytes > 50 * 1024 * 1024)
      throw conflict('REPOSITORY_TOO_LARGE', 'The project exceeds the size limits.');
    if (kind === 'manual' && !(await repo.git.hasChanges()))
      throw conflict('NOTHING_TO_SAVE', 'There are no changes since the last checkpoint.');
    await repo.git.addAll();
    const sha = await repo.git.commit(message, await this.author(tx, actor.userId), COMMITTER);
    const row = await this.state(tx, projectId);
    const revision = row?.workingRevision ?? 0;
    await tx
      .update(projectRepositories)
      .set({ headCommit: sha, updatedAt: sql`now()` })
      .where(eq(projectRepositories.projectId, projectId));
    const [checkpoint] = await tx
      .insert(projectCheckpoints)
      .values({
        projectId,
        organizationId: actor.organizationId,
        commitSha: sha,
        message,
        kind,
        revision,
        restoredFrom,
        authorId: actor.userId,
      })
      .returning();
    if (!checkpoint) throw new Error('Checkpoint insert returned no row');
    await this.writeBundle(actor.organizationId, projectId, repo.git);
    return checkpoint;
  }

  listCheckpoints(tx: Database, projectId: string, limit: number) {
    return tx
      .select({
        id: projectCheckpoints.id,
        commitSha: projectCheckpoints.commitSha,
        message: projectCheckpoints.message,
        kind: projectCheckpoints.kind,
        revision: projectCheckpoints.revision,
        restoredFrom: projectCheckpoints.restoredFrom,
        authorName: users.displayName,
        createdAt: projectCheckpoints.createdAt,
      })
      .from(projectCheckpoints)
      .leftJoin(users, eq(users.id, projectCheckpoints.authorId))
      .where(eq(projectCheckpoints.projectId, projectId))
      .orderBy(desc(projectCheckpoints.createdAt), desc(projectCheckpoints.id))
      .limit(limit);
  }

  /**
   * Restores the working tree to a checkpoint as a NEW commit (history is never rewritten).
   * Uncommitted work is first saved as a safety checkpoint unless the caller discards it.
   */
  async restore(
    tx: Database,
    actor: RepoActor,
    projectId: string,
    checkpointId: string,
    options: { safetyCheckpoint: boolean },
  ) {
    await this.ensureReady(tx, actor, projectId);
    const [target] = await tx
      .select()
      .from(projectCheckpoints)
      .where(
        and(eq(projectCheckpoints.id, checkpointId), eq(projectCheckpoints.projectId, projectId)),
      );
    if (!target) throw new NotFoundException('Checkpoint not found');
    const repo = this.open(actor.organizationId, projectId);
    if (!(await repo.git.commitExists(target.commitSha)))
      throw conflict('CHECKPOINT_MISSING', 'This checkpoint is no longer in the repository.');
    if (options.safetyCheckpoint && (await repo.git.hasChanges()))
      await this.checkpoint(tx, actor, projectId, 'Before restore (automatic)', 'safety');
    await repo.git.restoreTree(target.commitSha);
    const manifest = parseManifest(await repo.fs.readText(MANIFEST_PATH));
    await this.syncPages(tx, actor.organizationId, projectId, manifest);
    await this.bumpRevision(tx, projectId, repo.marker);
    return this.checkpoint(
      tx,
      actor,
      projectId,
      `Restore to "${target.message.slice(0, 120)}"`,
      'restore',
      target.id,
    );
  }

  /** Best-effort per-project backup bundle after each checkpoint (Blob upload: slice 2.6f). */
  private async writeBundle(organizationId: string, projectId: string, git: Git): Promise<void> {
    if (!this.config.BUNDLE_ROOT) return;
    try {
      const dir = join(this.config.BUNDLE_ROOT, organizationId, projectId);
      await mkdir(dir, { recursive: true });
      await git.bundle(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.bundle`));
    } catch (error) {
      this.logger.error({ err: error, projectId }, 'Backup bundle failed');
    }
  }
}
