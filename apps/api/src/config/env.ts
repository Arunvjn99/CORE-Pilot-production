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
    API_DOCS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
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
