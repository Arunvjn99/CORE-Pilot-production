/** Integration tests require real Postgres + Redis. Missing env is a failure, never a silent skip. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for integration tests (see scripts/test-integration.sh)`);
  return value;
}
