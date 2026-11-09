import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from '../../src/db/database.js';
import { requireEnv } from './env.js';

export default async function setup(): Promise<void> {
  const pool = createPool(requireEnv('TEST_ADMIN_DATABASE_URL'), 1);
  try {
    await migrate(createDatabase(pool), {
      migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle'),
    });
  } finally {
    await pool.end();
  }
}
