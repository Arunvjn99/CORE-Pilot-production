import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './database.js';

/**
 * Applies versioned migrations. Runs as a one-off job with the privileged MIGRATION_DATABASE_URL;
 * the API itself connects as a non-owner role and never alters schema.
 */
const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');

const pool = createPool(url, 1);
try {
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
  await migrate(createDatabase(pool), { migrationsFolder });
  process.stdout.write('Migrations applied\n');
} finally {
  await pool.end();
}
