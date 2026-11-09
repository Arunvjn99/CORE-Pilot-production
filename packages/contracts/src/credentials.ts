import { z } from 'zod';

export const llmProviderSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'azure_openai',
  'ollama',
]);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

/** Providers whose endpoint is customer-specific. Others use the vendor's fixed public API. */
export const PROVIDERS_WITH_ENDPOINT: readonly LlmProvider[] = ['azure_openai', 'ollama'];
/** Providers that can run without an API key (self-hosted). */
export const PROVIDERS_WITHOUT_SECRET: readonly LlmProvider[] = ['ollama'];

const secret = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => v.trim() === v, 'Must not start or end with whitespace');

export const credentialInputSchema = z
  .object({
    provider: llmProviderSchema,
    label: z.string().trim().min(1).max(80),
    secret: secret.optional(),
    endpoint: z
      .url({ protocol: /^https?$/ })
      .max(500)
      .optional(),
    apiVersion: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z.-]{1,40}$/)
      .optional(),
    deployment: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z._-]{1,100}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const needsEndpoint = PROVIDERS_WITH_ENDPOINT.includes(value.provider);
    if (needsEndpoint && !value.endpoint)
      ctx.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'Endpoint is required for this provider',
      });
    if (!needsEndpoint && value.endpoint)
      ctx.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'This provider uses its public API endpoint',
      });
    if (!PROVIDERS_WITHOUT_SECRET.includes(value.provider) && !value.secret) {
      ctx.addIssue({
        code: 'custom',
        path: ['secret'],
        message: 'An API key is required for this provider',
      });
    }
    if (value.provider === 'azure_openai') {
      if (!value.deployment)
        ctx.addIssue({
          code: 'custom',
          path: ['deployment'],
          message: 'Deployment is required for Azure OpenAI',
        });
      if (!value.apiVersion)
        ctx.addIssue({
          code: 'custom',
          path: ['apiVersion'],
          message: 'API version is required for Azure OpenAI',
        });
    } else if (value.deployment || value.apiVersion) {
      ctx.addIssue({
        code: 'custom',
        path: ['deployment'],
        message: 'Only Azure OpenAI uses deployment and API version',
      });
    }
  });

export const createCredentialSchema = z.intersection(
  z.object({ scope: z.enum(['organization', 'user']) }),
  credentialInputSchema,
);
export type CreateCredential = z.infer<typeof createCredentialSchema>;
export const createPlatformCredentialSchema = credentialInputSchema;

export const rotateCredentialSchema = z.object({ secret });

export const credentialSummarySchema = z.object({
  id: z.uuid(),
  scope: z.enum(['organization', 'user', 'platform']),
  provider: llmProviderSchema,
  label: z.string(),
  endpoint: z.string().nullable(),
  apiVersion: z.string().nullable(),
  deployment: z.string().nullable(),
  status: z.enum(['active', 'revoked']),
  hasSecret: z.boolean(),
  displayHint: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  rotatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type CredentialSummary = z.infer<typeof credentialSummarySchema>;

export const credentialPolicySchema = z.object({ allowPersonalCredentials: z.boolean() });
export type CredentialPolicy = z.infer<typeof credentialPolicySchema>;

export const entitlementsSchema = z.object({ organizationIds: z.array(z.uuid()).max(500) });
