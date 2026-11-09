import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Every tenant-owned table carries organization_id and a FORCE'd RLS policy keyed on the
 * transaction-local settings set by withDbContext(): `app.organization_id` (active team),
 * `app.user_id` (signed-in user) and `app.platform_admin` (company admin, verified from the DB).
 * In this single-company deployment an "organization" is a team/workspace (ADR-0009).
 */
const currentOrganization = sql`nullif(current_setting('app.organization_id', true), '')::uuid`;
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const isPlatformAdmin = sql`coalesce(current_setting('app.platform_admin', true), '') = 'true'`;

const tenantIsolation = (table: string) =>
  pgPolicy(`${table}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    using: sql`organization_id = ${currentOrganization}`,
    withCheck: sql`organization_id = ${currentOrganization}`,
  });

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('organizations_self_only', {
      as: 'permissive',
      for: 'all',
      using: sql`${t.id} = ${currentOrganization}`,
      withCheck: sql`${t.id} = ${currentOrganization}`,
    }),
    pgPolicy('organizations_member_read', {
      as: 'permissive',
      for: 'select',
      using: sql`exists (select 1 from organization_memberships m where m.organization_id = ${t.id} and m.user_id = ${currentUser})`,
    }),
    pgPolicy('organizations_platform_admin', {
      as: 'permissive',
      for: 'all',
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
  ],
).enableRLS();

export const platformRole = pgEnum('platform_role', ['none', 'platform_admin']);

/**
 * Company directory (single Entra tenant). Not team-scoped, so no RLS; the runtime role may only
 * SELECT. Rows are created/updated exclusively by the SECURITY DEFINER function auth_upsert_user().
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entraTenantId: uuid('entra_tenant_id').notNull(),
    entraObjectId: uuid('entra_object_id').notNull(),
    email: text('email'),
    displayName: text('display_name').notNull(),
    platformRole: platformRole('platform_role').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_entra_identity_idx').on(t.entraTenantId, t.entraObjectId)],
);

export const membershipRole = pgEnum('membership_role', [
  'org_owner',
  'org_admin',
  'designer',
  'viewer',
]);

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('organization_memberships_user_idx').on(t.userId),
    pgPolicy('memberships_active_org', {
      as: 'permissive',
      for: 'all',
      using: sql`${t.organizationId} = ${currentOrganization}`,
      withCheck: sql`${t.organizationId} = ${currentOrganization}`,
    }),
    pgPolicy('memberships_self_read', {
      as: 'permissive',
      for: 'select',
      using: sql`${t.userId} = ${currentUser}`,
    }),
    pgPolicy('memberships_platform_admin', {
      as: 'permissive',
      for: 'all',
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * Security-relevant events that are not scoped to a team (sign-in, sign-out, failures).
 * Append-only for the runtime role (INSERT only, no SELECT); never contains tokens or secrets.
 */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull(),
    userId: uuid('user_id'),
    correlationId: text('correlation_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('security_events_time_idx').on(t.occurredAt)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    correlationId: text('correlation_id').notNull(),
    /** Must never contain secrets; enforced by the audit service in Phase 2. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_org_time_idx').on(t.organizationId, t.occurredAt),
    tenantIsolation('audit_events'),
  ],
).enableRLS();
