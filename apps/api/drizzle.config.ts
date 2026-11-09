import { defineConfig } from 'drizzle-kit';

// Only used by `drizzle-kit generate` (offline). Migrations are applied by src/db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
