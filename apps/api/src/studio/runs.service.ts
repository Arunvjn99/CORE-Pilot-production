import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Run, RunStep } from '@core-studio/contracts';
import { runEventSchema } from '@core-studio/contracts';
import { pageFilePath } from '@core-studio/project-template';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { LlmSettingsService } from '../credentials/llm-settings.service.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { generationRuns, projectPages, projects, runSteps, users } from '../db/schema.js';
import { RuntimeClient } from '../gateway/runtime-client.js';
import { REDIS } from '../redis/redis.tokens.js';
import { RepositoriesService } from '../repositories/repositories.service.js';
import { LibraryService } from './library.service.js';
import { isValidScreen } from './source-edit.js';
import { DESIGN_MD_PATH, StudioService, TOKENS_PATH } from './studio.service.js';

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const STREAM_TTL_SECONDS = 3600;
const streamKey = (runId: string) => `run:${runId}:events`;
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

interface RunContext {
  organizationId: string;
  userId: string;
  platformAdmin: boolean;
}

interface GeneratedScreen {
  route: string;
  name: string;
  code: string;
}

/**
 * Design runs: the API resolves the team's one key, the AGENT.md set and the project's DESIGN.md,
 * starts the LangGraph run in the AI runtime, records every agent step for the metrics dashboard,
 * relays events to the studio through a Redis stream (works across API replicas) and commits the
 * validated screens to the project repository with a checkpoint.
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeClient,
    private readonly llm: LlmSettingsService,
    private readonly library: LibraryService,
    private readonly studio: StudioService,
    private readonly repositories: RepositoriesService,
    private readonly audit: AuditService,
  ) {}

  private staleCutoff() {
    return sql`now() - make_interval(secs => ${this.config.DESIGN_RUN_TIMEOUT_SECONDS + 120})`;
  }

  private async publish(runId: string, event: Record<string, unknown>) {
    const parsed = runEventSchema.safeParse(event);
    if (!parsed.success) return;
    const key = streamKey(runId);
    await this.redis.xadd(key, 'MAXLEN', '~', '2000', '*', 'e', JSON.stringify(parsed.data));
    await this.redis.expire(key, STREAM_TTL_SECONDS);
  }

  async start(
    auth: AuthContext,
    projectId: string,
    prompt: string,
    correlationId: string,
  ): Promise<{ id: string }> {
    const ctx = this.library.ctx(auth);
    const prepared = await withDbContext(this.db, ctx, async (tx) => {
      await this.studio.lockProject(tx, projectId, true);
      // Runs that outlived the timeout (e.g. API restart) are closed before checking for a running one.
      await tx
        .update(generationRuns)
        .set({ status: 'failed', errorCode: 'timeout', finishedAt: sql`now()` })
        .where(
          and(
            eq(generationRuns.status, 'running'),
            sql`${generationRuns.startedAt} < ${this.staleCutoff()}`,
          ),
        );
      const [running] = await tx
        .select({ id: generationRuns.id })
        .from(generationRuns)
        .where(and(eq(generationRuns.projectId, projectId), eq(generationRuns.status, 'running')));
      if (running)
        throw conflict('RUN_IN_PROGRESS', 'A design run is already in progress for this project.');

      const target = await this.llm.defaultTarget(tx, ctx.organizationId);
      if (!target)
        throw conflict(
          'NO_DEFAULT_MODEL',
          'Choose the default model and key in Settings → AI providers before generating designs.',
        );
      const agents = await this.library.resolveAgents(tx);
      const actor = { userId: auth.userId, organizationId: ctx.organizationId };
      const manifest = await this.repositories.ensureReady(tx, actor, projectId);
      const designMd = (await this.repositories.readFile(actor, projectId, DESIGN_MD_PATH)) ?? '';
      const tokensCss = (await this.repositories.readFile(actor, projectId, TOKENS_PATH)) ?? '';
      const [project] = await tx
        .select({ slug: projects.designSystemSlug })
        .from(projects)
        .where(eq(projects.id, projectId));
      const revision = await this.repositories.revision(tx, projectId);
      const [run] = await tx
        .insert(generationRuns)
        .values({
          organizationId: ctx.organizationId,
          projectId,
          prompt,
          provider: target.provider,
          agentVersions: Object.fromEntries(agents.map((a) => [a.key, a.version])),
          designSystem: { slug: project?.slug ?? null, version: revision },
          startedBy: auth.userId,
        })
        .returning({ id: generationRuns.id });
      if (!run) throw new Error('Run insert returned no row');
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'run.started',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { runId: run.id, provider: target.provider, model: target.model },
      });
      const body = {
        runId: run.id,
        provider: target.provider,
        endpoint: target.endpoint,
        apiVersion: target.apiVersion,
        deployment: target.deployment,
        sealed: target.sealed,
        prompt,
        designMd: `${designMd}\n\n## tokens.css (use these CSS variables)\n\`\`\`css\n${tokensCss}\n\`\`\``,
        existing: manifest.pages.map((p) => ({ name: p.name, route: p.route })),
        agents: Object.fromEntries(
          agents.map((a) => [
            a.key,
            { instructions: a.instructions, model: a.model ?? target.model, enabled: a.enabled },
          ]),
        ),
        maxFixRounds: 1,
      };
      return { runId: run.id, body };
    });
    // Runs in the background; the studio follows it through GET …/events.
    void this.execute(ctx, projectId, prepared.runId, prepared.body, correlationId).catch(
      (error: unknown) => {
        this.logger.error({ err: error, runId: prepared.runId }, 'Design run crashed');
      },
    );
    return { id: prepared.runId };
  }

  private async execute(
    ctx: RunContext,
    projectId: string,
    runId: string,
    body: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    let seq = 0;
    const openSteps = new Map<string, number>();
    let screens: GeneratedScreen[] = [];
    let review: { route: string; score: number; pass: boolean }[] = [];
    let title: string | null = null;
    const outcome: { errorCode: string | null } = { errorCode: null };
    let traced = false;

    const db = <T>(fn: (tx: Database) => Promise<T>) => withDbContext(this.db, ctx, fn);

    await this.runtime.streamDesignRun(body, correlationId, async (event) => {
      const type = String(event['type']);
      const agent = str(event['agent'], '');
      const label = str(event['label'], '');
      if (type === 'step_started') {
        seq += 1;
        openSteps.set(`${agent}:${label}`, seq);
        const stepSeq = seq;
        await db((tx) =>
          tx.insert(runSteps).values({
            runId,
            organizationId: ctx.organizationId,
            seq: stepSeq,
            agentKey: agent,
            label,
            status: 'running',
          }),
        );
      } else if (type === 'step_finished' || type === 'step_failed') {
        const stepSeq = openSteps.get(`${agent}:${label}`);
        openSteps.delete(`${agent}:${label}`);
        if (stepSeq !== undefined)
          await db((tx) =>
            tx
              .update(runSteps)
              .set(
                type === 'step_finished'
                  ? {
                      status: 'succeeded',
                      model: str(event['model'], ''),
                      inputTokens: Number(event['inputTokens'] ?? 0),
                      outputTokens: Number(event['outputTokens'] ?? 0),
                      durationMs: Number(event['durationMs'] ?? 0),
                    }
                  : { status: 'failed', errorCode: str(event['code'], 'failed') },
              )
              .where(and(eq(runSteps.runId, runId), eq(runSteps.seq, stepSeq))),
          );
      } else if (type === 'plan') {
        title = str(event['title'], '') || null;
        await db((tx) =>
          tx.update(generationRuns).set({ title }).where(eq(generationRuns.id, runId)),
        );
      } else if (type === 'review') {
        review = (Array.isArray(event['screens']) ? event['screens'] : []) as typeof review;
      } else if (type === 'done') {
        screens = (Array.isArray(event['screens']) ? event['screens'] : []) as GeneratedScreen[];
        traced = event['traced'] === true;
        return; // final event is published after saving
      } else if (type === 'error') {
        outcome.errorCode = str(event['code'], 'internal_error');
        return;
      }
      await this.publish(
        runId,
        type === 'screen' ? { type, name: event['name'], route: event['route'] } : event,
      );
    });

    if (!outcome.errorCode && screens.length === 0) outcome.errorCode = 'no_screens';
    let errorCode = outcome.errorCode;
    let checkpointId: string | null = null;
    let saved = 0;
    if (!errorCode) {
      try {
        const result = await this.save(ctx, projectId, runId, title, screens, correlationId);
        checkpointId = result.checkpointId;
        saved = result.saved;
        await this.publish(runId, { type: 'saved', revision: result.revision, checkpointId });
        if (saved === 0) errorCode = 'invalid_screens';
      } catch (error) {
        this.logger.error({ err: error, runId }, 'Saving generated screens failed');
        errorCode = error instanceof ConflictException ? 'project_locked' : 'save_failed';
      }
    }
    const scores = review.filter((r) => typeof r.score === 'number').map((r) => r.score);
    await db(async (tx) => {
      const [totals] = await tx
        .select({
          input: sql<number>`coalesce(sum(${runSteps.inputTokens}),0)::int`,
          output: sql<number>`coalesce(sum(${runSteps.outputTokens}),0)::int`,
        })
        .from(runSteps)
        .where(eq(runSteps.runId, runId));
      await tx
        .update(runSteps)
        .set({ status: 'failed', errorCode: 'interrupted' })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.status, 'running')));
      await tx
        .update(generationRuns)
        .set({
          status: errorCode ? 'failed' : 'succeeded',
          errorCode,
          inputTokens: totals?.input ?? 0,
          outputTokens: totals?.output ?? 0,
          screens: saved,
          reviewScore: scores.length
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : null,
          review,
          traced,
          checkpointId,
          finishedAt: sql`now()`,
        })
        .where(eq(generationRuns.id, runId));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: errorCode ? 'run.failed' : 'run.succeeded',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { runId, screens: saved, errorCode },
      });
    });
    await this.publish(runId, {
      type: 'done',
      status: errorCode ? 'failed' : 'succeeded',
      errorCode,
    });
  }

  /** Validates and commits generated screens: new routes become pages; each screen is one file. */
  private async save(
    ctx: RunContext,
    projectId: string,
    runId: string,
    title: string | null,
    screens: GeneratedScreen[],
    correlationId: string,
  ) {
    return withDbContext(this.db, ctx, async (tx) => {
      await this.studio.lockProject(tx, projectId, true);
      const actor = { userId: ctx.userId, organizationId: ctx.organizationId };
      let manifest = await this.repositories.ensureReady(tx, actor, projectId);
      const files: { path: string; content: string }[] = [];
      for (const screen of screens) {
        if (!isValidScreen(screen.code)) {
          this.logger.warn(
            { runId, route: screen.route },
            'Generated screen is not valid TSX; skipped',
          );
          continue;
        }
        let page = manifest.pages.find((p) => p.route === screen.route);
        if (!page) {
          page = await this.repositories.createPage(tx, actor, projectId, {
            name: screen.name.slice(0, 80) || 'Screen',
            route: screen.route,
          });
          manifest = await this.repositories.ensureReady(tx, actor, projectId);
        }
        files.push({ path: pageFilePath(page), content: screen.code });
      }
      const revision = files.length
        ? await this.repositories.writeFiles(tx, actor, projectId, files)
        : await this.repositories.revision(tx, projectId);
      let checkpointId: string | null = null;
      if (files.length) {
        const checkpoint = await this.repositories.checkpoint(
          tx,
          actor,
          projectId,
          `AI: ${(title ?? 'Design run').slice(0, 150)}`,
          'manual',
        );
        checkpointId = checkpoint.id;
      }
      await tx
        .update(projects)
        .set({ updatedAt: sql`now()` })
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: 'run.screens_saved',
        targetType: 'project',
        targetId: projectId,
        correlationId,
        metadata: { runId, files: files.map((f) => f.path) },
      });
      return { revision, checkpointId, saved: files.length };
    });
  }

  // ---------- reads ----------

  private async loadRun(tx: Database, projectId: string, runId: string): Promise<Run> {
    const [row] = await tx
      .select({ run: generationRuns, startedByName: users.displayName })
      .from(generationRuns)
      .leftJoin(users, eq(users.id, generationRuns.startedBy))
      .where(and(eq(generationRuns.id, runId), eq(generationRuns.projectId, projectId)));
    if (!row) throw new NotFoundException('Run not found');
    const steps = await tx
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(asc(runSteps.seq));
    return this.toRun(row.run, row.startedByName, steps);
  }

  private toRun(
    run: typeof generationRuns.$inferSelect,
    startedByName: string | null,
    steps: (typeof runSteps.$inferSelect)[],
  ): Run {
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      prompt: run.prompt,
      title: run.title,
      errorCode: run.errorCode,
      startedByName,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      screens: run.screens,
      reviewScore: run.reviewScore,
      traced: run.traced,
      steps: steps.map((s): RunStep => ({
        agent: s.agentKey as RunStep['agent'],
        label: s.label,
        status: s.status,
        model: s.model,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        durationMs: s.durationMs,
        errorCode: s.errorCode,
      })),
    };
  }

  get(auth: AuthContext, projectId: string, runId: string): Promise<Run> {
    return withDbContext(this.db, this.library.ctx(auth), (tx) =>
      this.loadRun(tx, projectId, runId),
    );
  }

  list(auth: AuthContext, projectId: string): Promise<Run[]> {
    return withDbContext(this.db, this.library.ctx(auth), async (tx) => {
      const rows = await tx
        .select({ run: generationRuns, startedByName: users.displayName })
        .from(generationRuns)
        .leftJoin(users, eq(users.id, generationRuns.startedBy))
        .where(eq(generationRuns.projectId, projectId))
        .orderBy(desc(generationRuns.startedAt))
        .limit(20);
      return rows.map((r) => this.toRun(r.run, r.startedByName, []));
    });
  }

  /** Confirms the run belongs to the caller's team and project before streaming its events. */
  async assertVisible(auth: AuthContext, projectId: string, runId: string): Promise<void> {
    await withDbContext(this.db, this.library.ctx(auth), async (tx) => {
      const [row] = await tx
        .select({ id: generationRuns.id })
        .from(generationRuns)
        .where(and(eq(generationRuns.id, runId), eq(generationRuns.projectId, projectId)));
      if (!row) throw new NotFoundException('Run not found');
    });
  }

  /** Reads the run's event stream from the start; blocks up to `blockMs` for new events. */
  async readEvents(
    reader: Redis,
    runId: string,
    after: string,
    blockMs: number,
  ): Promise<{ id: string; data: string }[]> {
    const result = await reader.xread(
      'COUNT',
      100,
      'BLOCK',
      blockMs,
      'STREAMS',
      streamKey(runId),
      after,
    );
    if (!result) return [];
    return (result[0]?.[1] ?? []).map(([id, fields]) => ({ id, data: fields[1] ?? '{}' }));
  }

  duplicateRedis(): Redis {
    return this.redis.duplicate();
  }

  /** Page ids for the run's routes (studio focuses new screens). */
  pagesForProject(auth: AuthContext, projectId: string) {
    return withDbContext(this.db, this.library.ctx(auth), (tx) =>
      tx
        .select({ id: projectPages.id, route: projectPages.route })
        .from(projectPages)
        .where(eq(projectPages.projectId, projectId)),
    );
  }
}
