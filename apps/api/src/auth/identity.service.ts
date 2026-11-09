import { Inject, Injectable } from '@nestjs/common';
import type { MembershipRole } from '@core-studio/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { organizationMemberships, organizations, users } from '../db/schema.js';
import type { VerifiedIdentity } from './oidc.service.js';

export interface UserState {
  id: string;
  displayName: string;
  email: string | null;
  platformAdmin: boolean;
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates/updates the directory entry via the SECURITY DEFINER function (the only write path). */
  async upsertFromIdentity(
    identity: VerifiedIdentity,
  ): Promise<{ id: string; platformAdmin: boolean }> {
    const grantAdmin = this.config.BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS.includes(
      identity.objectId.toLowerCase(),
    );
    const result = await this.db.execute<{ id: string; platform_role: string }>(
      sql`select id, platform_role from auth_upsert_user(${identity.tenantId}::uuid, ${identity.objectId}::uuid, ${identity.email}, ${identity.displayName}, ${grantAdmin})`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('User upsert returned no row');
    return { id: row.id, platformAdmin: row.platform_role === 'platform_admin' };
  }

  /** Fresh user state plus the role on one team, read with RLS user context. */
  async loadUserAndRole(
    userId: string,
    organizationId: string | null,
  ): Promise<{ user: UserState; role: MembershipRole | null } | null> {
    return withDbContext(this.db, { userId }, async (tx) => {
      const [user] = await tx
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          platformRole: users.platformRole,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (!user) return null;
      let role: MembershipRole | null = null;
      if (organizationId) {
        const [membership] = await tx
          .select({ role: organizationMemberships.role })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.userId, userId),
              eq(organizationMemberships.organizationId, organizationId),
            ),
          );
        role = membership?.role ?? null;
      }
      return {
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          platformAdmin: user.platformRole === 'platform_admin',
        },
        role,
      };
    });
  }

  /** Teams the user belongs to; company admins see every team (role null where not a member). */
  async listOrganizations(
    userId: string,
    platformAdmin: boolean,
  ): Promise<{ id: string; name: string; role: MembershipRole | null }[]> {
    return withDbContext(this.db, { userId, platformAdmin }, (tx) =>
      tx
        .select({
          id: organizations.id,
          name: organizations.name,
          role: organizationMemberships.role,
        })
        .from(organizations)
        .leftJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, organizations.id),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .orderBy(asc(organizations.name)),
    );
  }
}
