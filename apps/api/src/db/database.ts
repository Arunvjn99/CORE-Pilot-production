import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export interface DbContext {
  /** Active team; scopes tenant-owned rows. */
  organizationId?: string | null;
  /** Signed-in user; enables self-scoped reads (own memberships/teams). */
  userId?: string | null;
  /** Company admin, as verified from the users table by the caller. */
  platformAdmin?: boolean;
}

/**
 * Runs `work` in a transaction with RLS context set via transaction-local settings,
 * so context can never leak across pooled connections.
 */
export async function withDbContext<T>(
  db: Database,
  context: DbContext,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  const { organizationId = null, userId = null, platformAdmin = false } = context;
  if (organizationId !== null && !isUuid(organizationId))
    throw new Error('Invalid organization id');
  if (userId !== null && !isUuid(userId)) throw new Error('Invalid user id');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.organization_id', ${organizationId ?? ''}, true),
      set_config('app.user_id', ${userId ?? ''}, true),
      set_config('app.platform_admin', ${platformAdmin ? 'true' : 'false'}, true)`);
    return work(tx);
  });
}

/** Tenant-only context (Phase 1 API, kept for callers that act purely within a team). */
export async function withTenant<T>(
  db: Database,
  organizationId: string,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  return withDbContext(db, { organizationId }, work);
}
