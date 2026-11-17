import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AgentDefinition,
  AgentKey,
  AgentVersion,
  CreateDesignSystem,
  DesignSystem,
  DesignSystemSummary,
  UpdateAgent,
  UpdateDesignSystem,
} from '@core-studio/contracts';
import {
  AGENT_KEYS,
  type DefaultAgent,
  type DefaultDesignSystem,
  loadDefaultAgents,
  loadDefaultDesignSystems,
  missingTokens,
} from '@core-studio/studio-library';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { agentDefinitions, designSystemVersions, users } from '../db/schema.js';

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const staleVersion = () =>
  conflict('STALE_VERSION', 'Someone saved a newer version. Reload and try again.');

export interface ResolvedAgent {
  key: AgentKey;
  version: number;
  instructions: string;
  model: string | null;
  enabled: boolean;
}

/**
 * Team-editable AGENT.md and DESIGN.md (decision: everything customisable). Shipped defaults come from
 * @core-studio/studio-library; every edit is a new immutable version, so runs can record exactly
 * what they used and teams can diff and revert.
 */
@Injectable()
export class LibraryService {
  private agentsDefaults: Promise<DefaultAgent[]> | null = null;
  private systemsDefaults: Promise<DefaultDesignSystem[]> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  defaultAgents() {
    this.agentsDefaults ??= loadDefaultAgents();
    return this.agentsDefaults;
  }

  defaultSystems() {
    this.systemsDefaults ??= loadDefaultDesignSystems();
    return this.systemsDefaults;
  }

  ctx(auth: AuthContext) {
    if (!auth.organizationId) throw new BadRequestException('Select a team first');
    return {
      organizationId: auth.organizationId,
      userId: auth.userId,
      platformAdmin: auth.platformAdmin,
    };
  }

  // ---------- agents ----------

  private async latestAgents(tx: Database) {
    return tx
      .selectDistinctOn([agentDefinitions.agentKey], {
        key: agentDefinitions.agentKey,
        version: agentDefinitions.version,
        instructions: agentDefinitions.instructions,
        model: agentDefinitions.model,
        enabled: agentDefinitions.enabled,
        createdAt: agentDefinitions.createdAt,
        authorName: users.displayName,
      })
      .from(agentDefinitions)
      .leftJoin(users, eq(users.id, agentDefinitions.createdBy))
      .orderBy(agentDefinitions.agentKey, desc(agentDefinitions.version));
  }

  /** Current definition of every agent (team version or shipped default). Runs inside the caller's tx. */
  async resolveAgents(tx: Database): Promise<ResolvedAgent[]> {
    const defaults = await this.defaultAgents();
    const latest = new Map((await this.latestAgents(tx)).map((r) => [r.key, r]));
    return defaults.map((d) => {
      const row = latest.get(d.key);
      return row
        ? {
            key: d.key,
            version: row.version,
            instructions: row.instructions,
            model: row.model,
            enabled: row.enabled,
          }
        : { key: d.key, version: 0, instructions: d.instructions, model: null, enabled: true };
    });
  }

  listAgents(auth: AuthContext): Promise<AgentDefinition[]> {
    return withDbContext(this.db, this.ctx(auth), async (tx) => {
      const defaults = await this.defaultAgents();
      const latest = new Map((await this.latestAgents(tx)).map((r) => [r.key, r]));
      return defaults.map((d) => {
        const row = latest.get(d.key);
        return {
          key: d.key,
          name: d.name,
          description: d.description,
          version: row?.version ?? 0,
          instructions: row?.instructions ?? d.instructions,
          model: row?.model ?? null,
          enabled: row?.enabled ?? true,
          customized: Boolean(row),
          updatedAt: row ? row.createdAt.toISOString() : null,
          updatedByName: row?.authorName ?? null,
        };
      });
    });
  }

  agentVersions(auth: AuthContext, key: AgentKey): Promise<AgentVersion[]> {
    return withDbContext(this.db, this.ctx(auth), async (tx) => {
      const rows = await tx
        .select({
          version: agentDefinitions.version,
          instructions: agentDefinitions.instructions,
          model: agentDefinitions.model,
          enabled: agentDefinitions.enabled,
          createdAt: agentDefinitions.createdAt,
          authorName: users.displayName,
        })
        .from(agentDefinitions)
        .leftJoin(users, eq(users.id, agentDefinitions.createdBy))
        .where(eq(agentDefinitions.agentKey, key))
        .orderBy(desc(agentDefinitions.version))
        .limit(100);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  }

  private async saveAgent(
    tx: Database,
    auth: AuthContext,
    organizationId: string,
    key: AgentKey,
    values: { instructions: string; model: string | null; enabled: boolean },
    expectedVersion: number,
    correlationId: string,
    action: string,
  ): Promise<number> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`agent:${organizationId}:${key}`}, 0))`,
    );
    const [current] = await tx
      .select({ version: agentDefinitions.version })
      .from(agentDefinitions)
      .where(eq(agentDefinitions.agentKey, key))
      .orderBy(desc(agentDefinitions.version))
      .limit(1);
    if ((current?.version ?? 0) !== expectedVersion) throw staleVersion();
    if (key === 'ui' && !values.enabled)
      throw conflict(
        'AGENT_REQUIRED',
        'The UI designer builds the screens and cannot be turned off.',
      );
    if (key === 'orchestrator' && !values.enabled)
      throw conflict(
        'AGENT_REQUIRED',
        'The orchestrator plans every run and cannot be turned off.',
      );
    const version = expectedVersion + 1;
    await tx
      .insert(agentDefinitions)
      .values({ organizationId, agentKey: key, version, createdBy: auth.userId, ...values });
    await this.audit.record(tx, {
      organizationId,
      actorId: auth.userId,
      action,
      targetType: 'agent',
      targetId: key,
      correlationId,
      metadata: { version, model: values.model, enabled: values.enabled },
    });
    return version;
  }

  updateAgent(auth: AuthContext, key: AgentKey, input: UpdateAgent, correlationId: string) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, (tx) =>
      this.saveAgent(
        tx,
        auth,
        ctx.organizationId,
        key,
        input,
        input.expectedVersion,
        correlationId,
        'agent.updated',
      ),
    );
  }

  /** Reverting creates a new version with old content (history is never rewritten). */
  revertAgent(
    auth: AuthContext,
    key: AgentKey,
    toVersion: number,
    expectedVersion: number,
    correlationId: string,
  ) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      let values: { instructions: string; model: string | null; enabled: boolean };
      if (toVersion === 0) {
        const d = (await this.defaultAgents()).find((a) => a.key === key);
        if (!d) throw new NotFoundException('Agent not found');
        values = { instructions: d.instructions, model: null, enabled: true };
      } else {
        const [row] = await tx
          .select()
          .from(agentDefinitions)
          .where(and(eq(agentDefinitions.agentKey, key), eq(agentDefinitions.version, toVersion)));
        if (!row) throw new NotFoundException('Version not found');
        values = { instructions: row.instructions, model: row.model, enabled: row.enabled };
      }
      return this.saveAgent(
        tx,
        auth,
        ctx.organizationId,
        key,
        values,
        expectedVersion,
        correlationId,
        'agent.reverted',
      );
    });
  }

  // ---------- design systems ----------

  private async latestSystems(tx: Database) {
    return tx
      .selectDistinctOn([designSystemVersions.slug], {
        slug: designSystemVersions.slug,
        version: designSystemVersions.version,
        name: designSystemVersions.name,
        designMd: designSystemVersions.designMd,
        tokensCss: designSystemVersions.tokensCss,
        custom: designSystemVersions.custom,
        createdAt: designSystemVersions.createdAt,
        authorName: users.displayName,
      })
      .from(designSystemVersions)
      .leftJoin(users, eq(users.id, designSystemVersions.createdBy))
      .orderBy(designSystemVersions.slug, desc(designSystemVersions.version));
  }

  async resolveSystem(tx: Database, slug: string): Promise<DesignSystem> {
    const all = await this.systemsIn(tx);
    const found = all.find((s) => s.slug === slug);
    if (!found) throw new NotFoundException('Design system not found');
    return found;
  }

  private async systemsIn(tx: Database): Promise<DesignSystem[]> {
    const defaults = await this.defaultSystems();
    const latest = await this.latestSystems(tx);
    const bySlug = new Map(latest.map((r) => [r.slug, r]));
    const shipped = defaults.map((d): DesignSystem => {
      const row = bySlug.get(d.slug);
      return {
        slug: d.slug,
        name: row?.name ?? d.name,
        version: row?.version ?? 0,
        custom: false,
        customized: Boolean(row),
        designMd: row?.designMd ?? d.designMd,
        tokensCss: row?.tokensCss ?? d.tokensCss,
        updatedAt: row ? row.createdAt.toISOString() : null,
        updatedByName: row?.authorName ?? null,
      };
    });
    const customs = latest
      .filter((r) => r.custom)
      .map((r): DesignSystem => ({
        slug: r.slug,
        name: r.name,
        version: r.version,
        custom: true,
        customized: true,
        designMd: r.designMd,
        tokensCss: r.tokensCss,
        updatedAt: r.createdAt.toISOString(),
        updatedByName: r.authorName,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...shipped, ...customs];
  }

  listSystems(auth: AuthContext): Promise<DesignSystemSummary[]> {
    return withDbContext(this.db, this.ctx(auth), async (tx) =>
      (await this.systemsIn(tx)).map(({ slug, name, version, custom, customized }) => ({
        slug,
        name,
        version,
        custom,
        customized,
      })),
    );
  }

  getSystem(auth: AuthContext, slug: string): Promise<DesignSystem> {
    return withDbContext(this.db, this.ctx(auth), (tx) => this.resolveSystem(tx, slug));
  }

  systemVersions(auth: AuthContext, slug: string) {
    return withDbContext(this.db, this.ctx(auth), async (tx) => {
      const rows = await tx
        .select({
          version: designSystemVersions.version,
          name: designSystemVersions.name,
          createdAt: designSystemVersions.createdAt,
          authorName: users.displayName,
        })
        .from(designSystemVersions)
        .leftJoin(users, eq(users.id, designSystemVersions.createdBy))
        .where(eq(designSystemVersions.slug, slug))
        .orderBy(desc(designSystemVersions.version))
        .limit(100);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  }

  private assertTokens(tokensCss: string) {
    const missing = missingTokens(tokensCss);
    if (missing.length)
      throw new BadRequestException({
        message: `tokens.css is missing required variables: ${missing.join(', ')}`,
        details: missing.map((m) => ({ path: 'tokensCss', message: `Missing ${m}` })),
      });
  }

  private async saveSystem(
    tx: Database,
    auth: AuthContext,
    organizationId: string,
    slug: string,
    values: { name: string; designMd: string; tokensCss: string; custom: boolean },
    expectedVersion: number,
    correlationId: string,
    action: string,
  ) {
    this.assertTokens(values.tokensCss);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ds:${organizationId}:${slug}`}, 0))`,
    );
    const [current] = await tx
      .select({ version: designSystemVersions.version })
      .from(designSystemVersions)
      .where(eq(designSystemVersions.slug, slug))
      .orderBy(desc(designSystemVersions.version))
      .limit(1);
    if ((current?.version ?? 0) !== expectedVersion) throw staleVersion();
    const version = expectedVersion + 1;
    await tx
      .insert(designSystemVersions)
      .values({ organizationId, slug, version, createdBy: auth.userId, ...values });
    await this.audit.record(tx, {
      organizationId,
      actorId: auth.userId,
      action,
      targetType: 'design_system',
      targetId: slug,
      correlationId,
      metadata: { version, name: values.name },
    });
    return this.resolveSystem(tx, slug);
  }

  updateSystem(auth: AuthContext, slug: string, input: UpdateDesignSystem, correlationId: string) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const existing = await this.resolveSystem(tx, slug);
      return this.saveSystem(
        tx,
        auth,
        ctx.organizationId,
        slug,
        {
          name: input.name,
          designMd: input.designMd,
          tokensCss: input.tokensCss,
          custom: existing.custom,
        },
        input.expectedVersion,
        correlationId,
        'design_system.updated',
      );
    });
  }

  createSystem(auth: AuthContext, input: CreateDesignSystem, correlationId: string) {
    const ctx = this.ctx(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      if ((await this.systemsIn(tx)).some((s) => s.slug === input.slug))
        throw conflict('SLUG_TAKEN', 'A design system with this id already exists.');
      return this.saveSystem(
        tx,
        auth,
        ctx.organizationId,
        input.slug,
        { name: input.name, designMd: input.designMd, tokensCss: input.tokensCss, custom: true },
        0,
        correlationId,
        'design_system.created',
      );
    });
  }

  allowedAgentKeys(): readonly AgentKey[] {
    return AGENT_KEYS;
  }
}
