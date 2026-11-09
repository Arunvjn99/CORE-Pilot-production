import { sql } from 'drizzle-orm';
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Phase 1 baseline. Identity tables (users, memberships, roles) arrive in Phase 2.
 * Every tenant-owned table carries organization_id and a FORCE'd RLS policy keyed on the
 * transaction-local setting `app.organization_id` (see withTenant()).
 */
const currentOrganization = sql`nullif(current_setting('app.organization_id', true), '')::uuid`;

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
  ],
).enableRLS();

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
