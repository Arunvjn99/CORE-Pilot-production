import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { CreateCredential, CredentialPolicy, CredentialSummary } from '@core-studio/contracts';
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { credentialInputSchema } from '@core-studio/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import {
  llmCredentials,
  organizationLlmDefaults,
  organizations,
  platformLlmCredentials,
  platformLlmEntitlements,
} from '../db/schema.js';
import { credentialAad, displayHint, type SealedSecret, sealSecret } from './crypto/envelope.js';
import { checkProviderEndpoint } from './endpoint-policy.js';
import type { KeyWrapper } from './crypto/key-wrapper.js';
import { KEY_WRAPPER } from './crypto/key-wrapper.provider.js';

type CredentialInput = z.infer<typeof credentialInputSchema>;

const REVOKED_MATERIAL = {
  ciphertext: null,
  iv: null,
  authTag: null,
  wrappedDek: null,
  status: 'revoked' as const,
  revokedAt: sql`now()`,
};

function sealedColumns(sealed: SealedSecret | null, secret: string | undefined) {
  return {
    hasSecret: sealed !== null,
    envelopeVersion: sealed?.envelopeVersion ?? null,
    ciphertext: sealed?.ciphertext ?? null,
    iv: sealed?.iv ?? null,
    authTag: sealed?.authTag ?? null,
    wrappedDek: sealed?.wrappedDek ?? null,
    kekId: sealed?.kekId ?? null,
    kekVersion: sealed?.kekVersion ?? null,
    wrapAlgorithm: sealed?.wrapAlgorithm ?? null,
    displayHint: secret ? displayHint(secret) : null,
  };
}

/** Columns safe to return: never ciphertext, wrapped keys or IVs. */
const summaryColumns = {
  id: llmCredentials.id,
  scope: llmCredentials.scope,
  provider: llmCredentials.provider,
  label: llmCredentials.label,
  endpoint: llmCredentials.endpoint,
  apiVersion: llmCredentials.apiVersion,
  deployment: llmCredentials.deployment,
  status: llmCredentials.status,
  hasSecret: llmCredentials.hasSecret,
  displayHint: llmCredentials.displayHint,
  createdAt: llmCredentials.createdAt,
  rotatedAt: llmCredentials.rotatedAt,
  lastTestCode: llmCredentials.lastTestCode,
  lastTestedAt: llmCredentials.lastTestedAt,
};

const platformSummaryColumns = {
  id: platformLlmCredentials.id,
  provider: platformLlmCredentials.provider,
  label: platformLlmCredentials.label,
  endpoint: platformLlmCredentials.endpoint,
  apiVersion: platformLlmCredentials.apiVersion,
  deployment: platformLlmCredentials.deployment,
  status: platformLlmCredentials.status,
  hasSecret: platformLlmCredentials.hasSecret,
  displayHint: platformLlmCredentials.displayHint,
  createdAt: platformLlmCredentials.createdAt,
  rotatedAt: platformLlmCredentials.rotatedAt,
  lastTestCode: platformLlmCredentials.lastTestCode,
  lastTestedAt: platformLlmCredentials.lastTestedAt,
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Injectable()
export class CredentialsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KEY_WRAPPER) private readonly wrapper: KeyWrapper,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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

  /** SSRF policy for customer endpoints; the AI runtime re-checks resolved addresses at call time. */
  private assertEndpoint(input: CredentialInput): void {
    if (!input.endpoint) return;
    const violation = checkProviderEndpoint(input.endpoint, {
      production: this.config.NODE_ENV === 'production',
      allowedPrivateHosts: this.config.LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS,
    });
    if (violation) {
      throw new BadRequestException({
        message: `Invalid provider endpoint: ${violation}`,
        details: [{ path: 'endpoint', message: violation }],
      });
    }
  }

  private seal(
    kind: 'team' | 'platform',
    id: string,
    secret: string | undefined,
  ): Promise<SealedSecret | null> {
    return secret
      ? sealSecret(this.wrapper, secret, credentialAad(kind, id))
      : Promise.resolve(null);
  }

  // ---------- team & personal ----------

  async list(auth: AuthContext): Promise<CredentialSummary[]> {
    const ctx = this.teamContext(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const team = await tx
        .select(summaryColumns)
        .from(llmCredentials)
        .where(eq(llmCredentials.organizationId, ctx.organizationId))
        .orderBy(desc(llmCredentials.createdAt));
      const platform = await tx
        .select(platformSummaryColumns)
        .from(platformLlmCredentials)
        .innerJoin(
          platformLlmEntitlements,
          eq(platformLlmEntitlements.credentialId, platformLlmCredentials.id),
        )
        .where(
          and(
            eq(platformLlmEntitlements.organizationId, ctx.organizationId),
            eq(platformLlmCredentials.status, 'active'),
          ),
        )
        .orderBy(asc(platformLlmCredentials.label));
      return [
        ...team.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          rotatedAt: iso(row.rotatedAt),
          lastTestedAt: iso(row.lastTestedAt),
        })),
        ...platform.map((row) => ({
          ...row,
          scope: 'platform' as const,
          createdAt: row.createdAt.toISOString(),
          rotatedAt: iso(row.rotatedAt),
          lastTestedAt: iso(row.lastTestedAt),
        })),
      ];
    });
  }

  async create(
    auth: AuthContext,
    input: CreateCredential,
    correlationId: string,
  ): Promise<CredentialSummary> {
    const ctx = this.teamContext(auth);
    this.assertEndpoint(input);
    if (input.scope === 'organization' && !auth.permissions.has('providers:manage'))
      throw new ForbiddenException('Insufficient permissions');
    if (input.scope === 'user' && !auth.permissions.has('credentials:personal'))
      throw new ForbiddenException('Insufficient permissions');

    const id = crypto.randomUUID();
    const sealed = await this.seal('team', id, input.secret);
    return withDbContext(this.db, ctx, async (tx) => {
      if (input.scope === 'user') {
        const [team] = await tx
          .select({ allowed: organizations.allowPersonalCredentials })
          .from(organizations)
          .where(eq(organizations.id, ctx.organizationId));
        if (!team?.allowed)
          throw new ForbiddenException({
            message: 'Personal credentials are disabled for this team',
            code: 'PERSONAL_CREDENTIALS_DISABLED',
          });
      }
      const [row] = await tx
        .insert(llmCredentials)
        .values({
          id,
          organizationId: ctx.organizationId,
          scope: input.scope,
          ownerUserId: input.scope === 'user' ? auth.userId : null,
          provider: input.provider,
          label: input.label,
          endpoint: input.endpoint ?? null,
          apiVersion: input.apiVersion ?? null,
          deployment: input.deployment ?? null,
          createdBy: auth.userId,
          ...sealedColumns(sealed, input.secret),
        })
        .returning(summaryColumns);
      if (!row) throw new Error('Insert returned no row');
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_credential.created',
        targetType: 'llm_credential',
        targetId: id,
        correlationId,
        metadata: {
          provider: input.provider,
          scope: input.scope,
          label: input.label,
          kekId: sealed?.kekId ?? null,
        },
      });
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        rotatedAt: iso(row.rotatedAt),
        lastTestedAt: iso(row.lastTestedAt),
      };
    });
  }

  async rotate(
    auth: AuthContext,
    id: string,
    secret: string,
    correlationId: string,
  ): Promise<void> {
    const ctx = this.teamContext(auth);
    const sealed = await this.seal('team', id, secret);
    await withDbContext(this.db, ctx, async (tx) => {
      const existing = await this.loadManageable(tx, auth, id);
      await tx
        .update(llmCredentials)
        .set({ ...sealedColumns(sealed, secret), rotatedAt: sql`now()` })
        .where(and(eq(llmCredentials.id, id), eq(llmCredentials.status, 'active')));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_credential.rotated',
        targetType: 'llm_credential',
        targetId: id,
        correlationId,
        metadata: { provider: existing.provider, scope: existing.scope },
      });
    });
  }

  async revoke(auth: AuthContext, id: string, correlationId: string): Promise<void> {
    const ctx = this.teamContext(auth);
    await withDbContext(this.db, ctx, async (tx) => {
      const existing = await this.loadManageable(tx, auth, id);
      await tx
        .update(llmCredentials)
        .set({ ...REVOKED_MATERIAL, revokedBy: auth.userId })
        .where(eq(llmCredentials.id, id));
      await tx
        .delete(organizationLlmDefaults)
        .where(eq(organizationLlmDefaults.teamCredentialId, id));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_credential.revoked',
        targetType: 'llm_credential',
        targetId: id,
        correlationId,
        metadata: { provider: existing.provider, scope: existing.scope },
      });
    });
  }

  /** RLS already hides other users' personal credentials; here we apply role rules per scope. */
  private async loadManageable(tx: Database, auth: AuthContext, id: string) {
    const [row] = await tx
      .select({
        scope: llmCredentials.scope,
        provider: llmCredentials.provider,
        status: llmCredentials.status,
        ownerUserId: llmCredentials.ownerUserId,
      })
      .from(llmCredentials)
      .where(eq(llmCredentials.id, id))
      .for('update');
    if (!row || row.status !== 'active') throw new NotFoundException('Credential not found');
    const allowed =
      row.scope === 'organization'
        ? auth.permissions.has('providers:manage')
        : row.ownerUserId === auth.userId;
    if (!allowed) throw new ForbiddenException('Insufficient permissions');
    return row;
  }

  async getPolicy(auth: AuthContext): Promise<CredentialPolicy> {
    const ctx = this.teamContext(auth);
    return withDbContext(this.db, ctx, async (tx) => {
      const [team] = await tx
        .select({ allowPersonalCredentials: organizations.allowPersonalCredentials })
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId));
      if (!team) throw new NotFoundException('Team not found');
      return team;
    });
  }

  async setPolicy(
    auth: AuthContext,
    policy: CredentialPolicy,
    correlationId: string,
  ): Promise<void> {
    const ctx = this.teamContext(auth);
    await withDbContext(this.db, ctx, async (tx) => {
      await tx
        .update(organizations)
        .set({ allowPersonalCredentials: policy.allowPersonalCredentials, updatedAt: sql`now()` })
        .where(eq(organizations.id, ctx.organizationId));
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'llm_policy.updated',
        targetType: 'organization',
        targetId: ctx.organizationId,
        correlationId,
        metadata: { ...policy },
      });
    });
  }

  // ---------- company-managed (platform) ----------

  private platformContext(auth: AuthContext) {
    return { userId: auth.userId, platformAdmin: auth.platformAdmin };
  }

  async listPlatform(auth: AuthContext) {
    return withDbContext(this.db, this.platformContext(auth), async (tx) => {
      const rows = await tx
        .select(platformSummaryColumns)
        .from(platformLlmCredentials)
        .orderBy(desc(platformLlmCredentials.createdAt));
      const grants = rows.length
        ? await tx
            .select()
            .from(platformLlmEntitlements)
            .where(
              inArray(
                platformLlmEntitlements.credentialId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      return rows.map((row) => ({
        ...row,
        scope: 'platform' as const,
        createdAt: row.createdAt.toISOString(),
        rotatedAt: iso(row.rotatedAt),
        lastTestedAt: iso(row.lastTestedAt),
        entitledOrganizationIds: grants
          .filter((g) => g.credentialId === row.id)
          .map((g) => g.organizationId),
      }));
    });
  }

  async createPlatform(
    auth: AuthContext,
    input: CredentialInput,
    correlationId: string,
  ): Promise<{ id: string }> {
    this.assertEndpoint(input);
    const id = crypto.randomUUID();
    const sealed = await this.seal('platform', id, input.secret);
    await withDbContext(this.db, this.platformContext(auth), (tx) =>
      tx.insert(platformLlmCredentials).values({
        id,
        provider: input.provider,
        label: input.label,
        endpoint: input.endpoint ?? null,
        apiVersion: input.apiVersion ?? null,
        deployment: input.deployment ?? null,
        createdBy: auth.userId,
        ...sealedColumns(sealed, input.secret),
      }),
    );
    await this.audit.security({
      eventType: 'llm_platform_credential.created',
      outcome: 'success',
      userId: auth.userId,
      correlationId,
      details: { credentialId: id, provider: input.provider },
    });
    return { id };
  }

  async rotatePlatform(
    auth: AuthContext,
    id: string,
    secret: string,
    correlationId: string,
  ): Promise<void> {
    const sealed = await this.seal('platform', id, secret);
    const updated = await withDbContext(this.db, this.platformContext(auth), (tx) =>
      tx
        .update(platformLlmCredentials)
        .set({ ...sealedColumns(sealed, secret), rotatedAt: sql`now()` })
        .where(and(eq(platformLlmCredentials.id, id), eq(platformLlmCredentials.status, 'active')))
        .returning({ id: platformLlmCredentials.id }),
    );
    if (updated.length === 0) throw new NotFoundException('Credential not found');
    await this.audit.security({
      eventType: 'llm_platform_credential.rotated',
      outcome: 'success',
      userId: auth.userId,
      correlationId,
      details: { credentialId: id },
    });
  }

  async revokePlatform(auth: AuthContext, id: string, correlationId: string): Promise<void> {
    const updated = await withDbContext(this.db, this.platformContext(auth), async (tx) => {
      const rows = await tx
        .update(platformLlmCredentials)
        .set({ ...REVOKED_MATERIAL, revokedBy: auth.userId })
        .where(and(eq(platformLlmCredentials.id, id), eq(platformLlmCredentials.status, 'active')))
        .returning({ id: platformLlmCredentials.id });
      await tx.delete(platformLlmEntitlements).where(eq(platformLlmEntitlements.credentialId, id));
      await tx
        .delete(organizationLlmDefaults)
        .where(eq(organizationLlmDefaults.platformCredentialId, id));
      return rows;
    });
    if (updated.length === 0) throw new NotFoundException('Credential not found');
    await this.audit.security({
      eventType: 'llm_platform_credential.revoked',
      outcome: 'success',
      userId: auth.userId,
      correlationId,
      details: { credentialId: id },
    });
  }

  async setEntitlements(
    auth: AuthContext,
    id: string,
    organizationIds: string[],
    correlationId: string,
  ): Promise<void> {
    const unique = [...new Set(organizationIds)];
    await withDbContext(this.db, this.platformContext(auth), async (tx) => {
      const [credential] = await tx
        .select({ status: platformLlmCredentials.status })
        .from(platformLlmCredentials)
        .where(eq(platformLlmCredentials.id, id))
        .for('update');
      if (credential?.status !== 'active') throw new NotFoundException('Credential not found');
      if (unique.length) {
        const found = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(inArray(organizations.id, unique));
        if (found.length !== unique.length)
          throw new BadRequestException('Unknown team in entitlement list');
      }
      await tx.delete(platformLlmEntitlements).where(eq(platformLlmEntitlements.credentialId, id));
      // Teams that lose access also lose this credential as their default model.
      await tx
        .delete(organizationLlmDefaults)
        .where(
          and(
            eq(organizationLlmDefaults.platformCredentialId, id),
            unique.length ? notInArray(organizationLlmDefaults.organizationId, unique) : sql`true`,
          ),
        );
      if (unique.length) {
        await tx.insert(platformLlmEntitlements).values(
          unique.map((organizationId) => ({
            credentialId: id,
            organizationId,
            grantedBy: auth.userId,
          })),
        );
      }
    });
    await this.audit.security({
      eventType: 'llm_platform_credential.entitlements_set',
      outcome: 'success',
      userId: auth.userId,
      correlationId,
      details: { credentialId: id, organizationIds: unique },
    });
  }
}
