import { z } from 'zod';

const csv = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const originList = csv.pipe(
  z
    .array(z.url({ protocol: /^https?$/ }))
    .min(1)
    .refine((origins) => !origins.includes('*'), 'Wildcard CORS origins are not allowed'),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    SERVICE_VERSION: z.string().min(1).default('0.0.0-dev'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    CORS_ALLOWED_ORIGINS: originList,
    AI_RUNTIME_URL: z.url({ protocol: /^https?$/ }),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    PUBLIC_APP_ORIGIN: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
    OIDC_ISSUER_URL: z.url({ protocol: /^https?$/ }),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_CLIENT_SECRET: z.string().min(16),
    /** Single-company deployment: only identities from this Entra tenant may sign in (ADR-0009). */
    OIDC_ALLOWED_TENANT_ID: z.uuid(),
    OIDC_SCOPES: z.string().default('openid profile email'),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    STEP_UP_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    /** Entra object IDs granted company-admin on sign-in (grant only; revocation is manual). */
    BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.uuid())),
    /** Envelope-encryption KEK source (ADR-0010). `local` is for development/test only. */
    CREDENTIAL_KEK_PROVIDER: z.enum(['local', 'azure-key-vault']).default('local'),
    LOCAL_KEK: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'LOCAL_KEK must be 32 bytes, base64-encoded',
      )
      .optional(),
    /** Versionless Key Vault key URL, e.g. https://<vault>.vault.azure.net/keys/<name> */
    AZURE_KEY_VAULT_KEY_ID: z.url({ protocol: /^https$/ }).optional(),
    API_DOCS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.CREDENTIAL_KEK_PROVIDER === 'local' && !env.LOCAL_KEK) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCAL_KEK'],
        message: 'Required when CREDENTIAL_KEK_PROVIDER=local',
      });
    }
    if (env.CREDENTIAL_KEK_PROVIDER === 'azure-key-vault' && !env.AZURE_KEY_VAULT_KEY_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['AZURE_KEY_VAULT_KEY_ID'],
        message: 'Required when CREDENTIAL_KEK_PROVIDER=azure-key-vault',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.CREDENTIAL_KEK_PROVIDER !== 'azure-key-vault' || env.LOCAL_KEK) {
      ctx.addIssue({
        code: 'custom',
        path: ['CREDENTIAL_KEK_PROVIDER'],
        message: 'Production requires azure-key-vault and no LOCAL_KEK',
      });
    }
    const sslMode = new URL(env.DATABASE_URL).searchParams.get('sslmode');
    if (sslMode !== 'require' && sslMode !== 'verify-full') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Production requires sslmode=require or verify-full',
      });
    }
    if (!env.REDIS_URL.startsWith('rediss://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'Production requires TLS (rediss://)',
      });
    }
    if (env.CORS_ALLOWED_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'Production origins must be https',
      });
    }
    if (!env.PUBLIC_APP_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_APP_ORIGIN'],
        message: 'Production requires https',
      });
    }
    const entraIssuer = `https://login.microsoftonline.com/${env.OIDC_ALLOWED_TENANT_ID}/v2.0`;
    if (env.OIDC_ISSUER_URL.replace(/\/$/, '') !== entraIssuer) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_ISSUER_URL'],
        message: `Production issuer must be ${entraIssuer}`,
      });
    }
    if (env.API_DOCS_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_DOCS_ENABLED'],
        message: 'API docs must be disabled in production',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/** Validates the environment once at startup. Throws with every problem listed; never falls back to insecure defaults. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}
