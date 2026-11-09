import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, createDatabase, createPool, withTenant } from '../../src/db/database.js';
import { auditEvents, organizations } from '../../src/db/schema.js';
import { requireEnv } from './env.js';

// Connects as the least-privilege runtime role, exactly like the API.
let pool: pg.Pool;
let db: Database;
const orgA = randomUUID();
const orgB = randomUUID();

beforeAll(async () => {
  pool = createPool(requireEnv('TEST_DATABASE_URL'), 2);
  db = createDatabase(pool);
  for (const [id, name] of [
    [orgA, 'Org A'],
    [orgB, 'Org B'],
  ] as const) {
    await withTenant(db, id, (tx) =>
      tx
        .insert(organizations)
        .values({ id, name })
        .then(() => undefined),
    );
    await withTenant(db, id, (tx) =>
      tx
        .insert(auditEvents)
        .values({
          organizationId: id,
          actorId: 'test',
          action: 'org.created',
          targetType: 'organization',
          correlationId: 'test-corr-0001',
        })
        .then(() => undefined),
    );
  }
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL row-level security', () => {
  it('connects as a role that cannot bypass RLS', async () => {
    const { rows } = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('shows a tenant only its own rows', async () => {
    const seen = await withTenant(db, orgA, (tx) =>
      tx.select({ org: auditEvents.organizationId }).from(auditEvents),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((row) => row.org === orgA)).toBe(true);
  });

  it('returns nothing without tenant context', async () => {
    const rows = await db.select().from(auditEvents);
    expect(rows).toHaveLength(0);
  });

  it('blocks writing into another tenant', async () => {
    await expect(
      withTenant(db, orgA, (tx) =>
        tx.insert(auditEvents).values({
          organizationId: orgB,
          actorId: 'attacker',
          action: 'x',
          targetType: 'x',
          correlationId: 'test-corr-0002',
        }),
      ),
    ).rejects.toThrow();
  });

  it('keeps audit events append-only for the runtime role', async () => {
    await expect(
      withTenant(db, orgA, (tx) =>
        tx
          .update(auditEvents)
          .set({ action: 'tampered' })
          .where(eq(auditEvents.organizationId, orgA)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, orgA, (tx) => tx.execute(sql`delete from audit_events`)),
    ).rejects.toThrow();
  });

  it('rejects malformed tenant ids before touching the database', async () => {
    await expect(withTenant(db, "x' or 1=1 --", () => Promise.resolve(1))).rejects.toThrow(
      'Invalid organization id',
    );
  });
});
