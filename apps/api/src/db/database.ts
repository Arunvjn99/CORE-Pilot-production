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

/**
 * Runs `work` in a transaction scoped to one organization. RLS policies read the
 * transaction-local setting, so tenant context cannot leak across pooled connections.
 */
export async function withTenant<T>(
  db: Database,
  organizationId: string,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  if (!UUID.test(organizationId)) throw new Error('Invalid organization id');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`);
    return work(tx);
  });
}
