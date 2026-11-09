import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  llmProviderSchema,
  type CredentialTestResult,
  type DefaultModel,
  type LlmActivity,
  type LlmProvider,
  type SetDefaultModel,
} from '@core-studio/contracts';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import {
  auditEvents,
  llmCredentials,
  organizationLlmDefaults,
  platformLlmCredentials,
  users,
} from '../db/schema.js';
import { RuntimeClient, type SealedPayload } from '../gateway/runtime-client.js';

interface SealedRow {
  id: string;
  provider: LlmProvider;
  endpoint: string | null;
  apiVersion: string | null;
  deployment: string | null;
  status: 'active' | 'revoked';
  hasSecret: boolean;
  envelopeVersion: number | null;
  ciphertext: Buffer | null;
  iv: Buffer | null;
  authTag: Buffer | null;
  wrappedDek: Buffer | null;
  kekId: string | null;
  kekVersion: string | null;
  wrapAlgorithm: string | null;
}

const sealedSelect = (t: typeof llmCredentials | typeof platformLlmCredentials) => ({
  id: t.id,
  provider: t.provider,
  endpoint: t.endpoint,
  apiVersion: t.apiVersion,
  deployment: t.deployment,
  status: t.status,
  hasSecret: t.hasSecret,
  envelopeVersion: t.envelopeVersion,
  ciphertext: t.ciphertext,
  iv: t.iv,
  authTag: t.authTag,
  wrappedDek: t.wrappedDek,
  kekId: t.kekId,
  kekVersion: t.kekVersion,
  wrapAlgorithm: t.wrapAlgorithm,
});

function sealedPayload(kind: 'team' | 'platform', row: SealedRow): SealedPayload | null {
  if (!row.hasSecret) return null;
  if (
    !row.ciphertext ||
    !row.iv ||
    !row.authTag ||
    !row.wrappedDek ||
    !row.kekId ||
    row.envelopeVersion === null
  )
    throw new NotFoundException('Credential not found');
  return {
    kind,
    credentialId: row.id,
    envelopeVersion: row.envelopeVersion,
    ciphertext: row.ciphertext.toString('base64'),
    iv: row.iv.toString('base64'),
    authTag: row.authTag.toString('base64'),
    wrappedDek: row.wrappedDek.toString('base64'),
    kekId: row.kekId,
    kekVersion: row.kekVersion ?? '',
    wrapAlgorithm: row.wrapAlgorithm ?? '',
  };
}

const ACTIVITY_LIMIT = 50;

/** Connection tests, default model and the activity feed for the AI provider settings (slice 2.4). */
@Injectable()
export class LlmSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runtime: RuntimeClient,
    private readonly audit: AuditService,
  ) {}

  private teamContext(auth: AuthContext) {
    if (!auth.organizationId) throw new ForbiddenException('Select a team first');
    return {
      organizationId: auth.organizationId,
      userId: auth.userId,
      platformAdmin: auth.platformAdmin,
    };
  }

  /**
   * Team view: team credentials (manage permission), own personal credentials, or entitled
   * company credentials (manage permission). Reading a platform row here relies on the
   * entitlement RLS policy, so non-entitled ids are indistinguishable from missing ones.
   */
  async testTeamCredential(
    auth: AuthContext,
    id: string,
    correlationId: string,
  ): Promise<CredentialTestResult> {
    const ctx = this.teamContext(auth);
    const loaded = await withDbContext(this.db, ctx, async (tx) => {
      const [team] = await tx
        .select({
          ...sealedSelect(llmCredentials),
          scope: llmCredentials.scope,
          ownerUserId: llmCredentials.ownerUserId,
        })
        .from(llmCredentials)
        .where(eq(llmCredentials.id, id));
      if (team)
        return { kind: 'team' as const, row: team, scope: team.scope, owner: team.ownerUserId };
      const [platform] = await tx
        .select(sealedSelect(platformLlmCredentials))
        .from(platformLlmCredentials)
        .where(eq(platformLlmCredentials.id, id));
      return platform
        ? { kind: 'platform' as const, row: platform, scope: 'platform' as const, owner: null }
        : null;
    });
    if (loaded?.row.status !== 'active') throw new NotFoundException('Credential not found');
    const allowed =
      loaded.scope === 'user'
        ? loaded.owner === auth.userId
        : auth.permissions.has('providers:manage');
    if (!allowed) throw new ForbiddenException('Insufficient permissions');

    const result = await this.runtime.probe(
      {
        provider: loaded.row.provider,
        endpoint: loaded.row.endpoint,
        apiVersion: loaded.row.apiVersion,
        deployment: loaded.row.deployment,
        sealed: sealedPayload(loaded.kind, loaded.row),
      },
      correlationId,
    );
    const testedAt = new Date();
    await withDbContext(this.db, ctx, async (tx) => {
      // Company credentials are only written by company admins; the team still gets an audit entry.
      if (loaded.kind === 'team' && result.code !== 'runtime_unavailable')
        await tx
          .update(llmCredentials)
          .set({ lastTestCode: result.code, lastTestedAt: testedAt })
          .where(eq(llmCredentials.id, id));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_credential.tested',
        targetType: loaded.kind === 'team' ? 'llm_credential' : 'platform_llm_credential',
        targetId: id,
        correlationId,
        metadata: { provider: loaded.row.provider, scope: loaded.scope, outcome: result.code },
      });
    });
    return { credentialId: id, ...result, testedAt: testedAt.toISOString() };
  }

  async testPlatformCredential(
    auth: AuthContext,
    id: string,
    correlationId: string,
  ): Promise<CredentialTestResult> {
    const ctx = { userId: auth.userId, platformAdmin: auth.platformAdmin };
    const [row] = await withDbContext(this.db, ctx, (tx) =>
      tx
        .select(sealedSelect(platformLlmCredentials))
        .from(platformLlmCredentials)
        .where(eq(platformLlmCredentials.id, id)),
    );
    if (row?.status !== 'active') throw new NotFoundException('Credential not found');
    const result = await this.runtime.probe(
      {
        provider: row.provider,
        endpoint: row.endpoint,
        apiVersion: row.apiVersion,
        deployment: row.deployment,
        sealed: sealedPayload('platform', row),
      },
      correlationId,
    );
    const testedAt = new Date();
    if (result.code !== 'runtime_unavailable')
      await withDbContext(this.db, ctx, (tx) =>
        tx
          .update(platformLlmCredentials)
          .set({ lastTestCode: result.code, lastTestedAt: testedAt })
          .where(eq(platformLlmCredentials.id, id)),
      );
    await this.audit.security({
      eventType: 'llm_platform_credential.tested',
      outcome: result.code === 'ok' ? 'success' : 'failure',
      userId: auth.userId,
      correlationId,
      details: { credentialId: id, provider: row.provider, code: result.code },
    });
    return { credentialId: id, ...result, testedAt: testedAt.toISOString() };
  }

  // ---------- default model ----------

  async getDefault(auth: AuthContext): Promise<DefaultModel> {
    const ctx = this.teamContext(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          teamCredentialId: organizationLlmDefaults.teamCredentialId,
          platformCredentialId: organizationLlmDefaults.platformCredentialId,
          model: organizationLlmDefaults.model,
          updatedAt: organizationLlmDefaults.updatedAt,
          teamLabel: llmCredentials.label,
          teamProvider: llmCredentials.provider,
          platformLabel: platformLlmCredentials.label,
          platformProvider: platformLlmCredentials.provider,
        })
        .from(organizationLlmDefaults)
        .leftJoin(llmCredentials, eq(llmCredentials.id, organizationLlmDefaults.teamCredentialId))
        .leftJoin(
          platformLlmCredentials,
          eq(platformLlmCredentials.id, organizationLlmDefaults.platformCredentialId),
        )
        .where(eq(organizationLlmDefaults.organizationId, ctx.organizationId));
      if (!row) return null;
      const credentialId = row.teamCredentialId ?? row.platformCredentialId;
      const provider = row.teamProvider ?? row.platformProvider;
      const label = row.teamLabel ?? row.platformLabel;
      // A company credential that is no longer entitled is invisible under RLS: treat as unset.
      if (!credentialId || !provider || label === null) return null;
      return {
        credentialId,
        credentialScope: row.teamCredentialId ? 'organization' : 'platform',
        credentialLabel: label,
        provider,
        model: row.model,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async setDefault(
    auth: AuthContext,
    input: SetDefaultModel,
    correlationId: string,
  ): Promise<void> {
    const ctx = this.teamContext(auth);
    await withDbContext(this.db, ctx, async (tx) => {
      const [team] = await tx
        .select({
          scope: llmCredentials.scope,
          status: llmCredentials.status,
          provider: llmCredentials.provider,
        })
        .from(llmCredentials)
        .where(eq(llmCredentials.id, input.credentialId));
      let ref: { teamCredentialId: string | null; platformCredentialId: string | null };
      let provider: LlmProvider;
      if (team) {
        // Personal credentials belong to one user and can never be the team default.
        if (team.scope !== 'organization' || team.status !== 'active')
          throw new NotFoundException('Credential not found');
        ref = { teamCredentialId: input.credentialId, platformCredentialId: null };
        provider = team.provider;
      } else {
        const [platform] = await tx
          .select({
            status: platformLlmCredentials.status,
            provider: platformLlmCredentials.provider,
          })
          .from(platformLlmCredentials)
          .where(eq(platformLlmCredentials.id, input.credentialId));
        if (platform?.status !== 'active') throw new NotFoundException('Credential not found');
        ref = { teamCredentialId: null, platformCredentialId: input.credentialId };
        provider = platform.provider;
      }
      const values = {
        ...ref,
        model: input.model,
        updatedBy: auth.userId,
        updatedAt: sql`now()`,
      };
      await tx
        .insert(organizationLlmDefaults)
        .values({ organizationId: ctx.organizationId, ...values })
        .onConflictDoUpdate({ target: organizationLlmDefaults.organizationId, set: values });
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_default_model.updated',
        targetType: 'organization',
        targetId: ctx.organizationId,
        correlationId,
        metadata: { provider, model: input.model, credentialId: input.credentialId },
      });
    });
  }

  async clearDefault(auth: AuthContext, correlationId: string): Promise<void> {
    const ctx = this.teamContext(auth);
    await withDbContext(this.db, ctx, async (tx) => {
      await tx
        .delete(organizationLlmDefaults)
        .where(eq(organizationLlmDefaults.organizationId, ctx.organizationId));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_default_model.cleared',
        targetType: 'organization',
        targetId: ctx.organizationId,
        correlationId,
      });
    });
  }

  // ---------- activity ----------

  /**
   * Recent AI-provider events for the active team. Personal-credential events are shown only to
   * the person who performed them (personal credentials are private, ADR-0010).
   */
  async activity(auth: AuthContext): Promise<LlmActivity[]> {
    const ctx = this.teamContext(auth);
    const rows = await withDbContext(this.db, ctx, (tx) =>
      tx
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          actorId: auditEvents.actorId,
          actorName: users.displayName,
          targetId: auditEvents.targetId,
          metadata: auditEvents.metadata,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .leftJoin(users, sql`${users.id}::text = ${auditEvents.actorId}`)
        .where(
          and(
            eq(auditEvents.organizationId, ctx.organizationId),
            like(auditEvents.action, 'llm\\_%'),
            sql`(${auditEvents.metadata}->>'scope' is distinct from 'user' or ${auditEvents.actorId} = ${auth.userId})`,
          ),
        )
        .orderBy(desc(auditEvents.occurredAt))
        .limit(ACTIVITY_LIMIT),
    );
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    return rows.map((row) => {
      const meta = row.metadata;
      const provider = llmProviderSchema.safeParse(meta['provider']);
      return {
        id: row.id,
        action: row.action,
        actorName: row.actorName,
        targetId: row.targetId,
        provider: provider.success ? provider.data : null,
        scope: text(meta['scope']),
        label: text(meta['label']) ?? text(meta['model']),
        outcome: text(meta['outcome']),
        occurredAt: row.occurredAt.toISOString(),
      };
    });
  }
}
