import {
  type CreateCredential,
  type CredentialPolicy,
  credentialPolicySchema,
  credentialSummarySchema,
  credentialTestResultSchema,
  defaultModelResponseSchema,
  llmActivitySchema,
  type SetDefaultModel,
} from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

const credentialList = z.array(credentialSummarySchema);
export const platformCredentialSchema = credentialSummarySchema.extend({
  entitledOrganizationIds: z.array(z.uuid()),
});
export type PlatformCredential = z.infer<typeof platformCredentialSchema>;

/** Team-scoped queries are keyed by team so switching teams never shows stale data. */
const keys = {
  all: (teamId: string) => ['llm', teamId] as const,
  credentials: (teamId: string) => ['llm', teamId, 'credentials'] as const,
  policy: (teamId: string) => ['llm', teamId, 'policy'] as const,
  defaultModel: (teamId: string) => ['llm', teamId, 'default-model'] as const,
  activity: (teamId: string) => ['llm', teamId, 'activity'] as const,
  platform: ['llm', 'platform'] as const,
};

export function useCredentials(teamId: string) {
  return useQuery({
    queryKey: keys.credentials(teamId),
    queryFn: ({ signal }) => apiGet('/api/v1/llm/credentials', credentialList, signal),
  });
}

export function usePolicy(teamId: string) {
  return useQuery({
    queryKey: keys.policy(teamId),
    queryFn: ({ signal }) => apiGet('/api/v1/llm/policy', credentialPolicySchema, signal),
  });
}

export function useDefaultModel(teamId: string) {
  return useQuery({
    queryKey: keys.defaultModel(teamId),
    queryFn: async ({ signal }) =>
      (await apiGet('/api/v1/llm/default-model', defaultModelResponseSchema, signal)).defaultModel,
  });
}

export function useActivity(teamId: string) {
  return useQuery({
    queryKey: keys.activity(teamId),
    queryFn: ({ signal }) => apiGet('/api/v1/llm/activity', z.array(llmActivitySchema), signal),
  });
}

export function usePlatformCredentials(enabled: boolean) {
  return useQuery({
    queryKey: keys.platform,
    enabled,
    queryFn: ({ signal }) =>
      apiGet('/api/v1/platform/llm-credentials', z.array(platformCredentialSchema), signal),
  });
}

/** Every mutation refreshes the team's credentials, default and activity feed. */
export function useLlmMutations(teamId: string | null) {
  const client = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      teamId ? client.invalidateQueries({ queryKey: keys.all(teamId) }) : null,
      client.invalidateQueries({ queryKey: keys.platform }),
    ]);
  };
  const created = z.object({ id: z.uuid() }).loose();
  return {
    create: useMutation({
      mutationFn: (body: CreateCredential) =>
        apiSend('POST', '/api/v1/llm/credentials', { body, schema: created }),
      onSuccess: refresh,
    }),
    rotate: useMutation({
      mutationFn: ({ id, secret, platform }: { id: string; secret: string; platform: boolean }) =>
        apiSend(
          'POST',
          platform
            ? `/api/v1/platform/llm-credentials/${id}/rotate`
            : `/api/v1/llm/credentials/${id}/rotate`,
          { body: { secret } },
        ),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: ({ id, platform }: { id: string; platform: boolean }) =>
        apiSend(
          'DELETE',
          platform ? `/api/v1/platform/llm-credentials/${id}` : `/api/v1/llm/credentials/${id}`,
        ),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: ({ id, platform }: { id: string; platform: boolean }) =>
        apiSend(
          'POST',
          platform
            ? `/api/v1/platform/llm-credentials/${id}/test`
            : `/api/v1/llm/credentials/${id}/test`,
          { schema: credentialTestResultSchema },
        ),
      onSettled: refresh,
    }),
    setPolicy: useMutation({
      mutationFn: (body: CredentialPolicy) => apiSend('PUT', '/api/v1/llm/policy', { body }),
      onSuccess: refresh,
    }),
    setDefault: useMutation({
      mutationFn: (body: SetDefaultModel) => apiSend('PUT', '/api/v1/llm/default-model', { body }),
      onSuccess: refresh,
    }),
    clearDefault: useMutation({
      mutationFn: () => apiSend('DELETE', '/api/v1/llm/default-model'),
      onSuccess: refresh,
    }),
    createPlatform: useMutation({
      mutationFn: (body: Omit<CreateCredential, 'scope'>) =>
        apiSend('POST', '/api/v1/platform/llm-credentials', { body, schema: created }),
      onSuccess: refresh,
    }),
    setEntitlements: useMutation({
      mutationFn: ({ id, organizationIds }: { id: string; organizationIds: string[] }) =>
        apiSend('PUT', `/api/v1/platform/llm-credentials/${id}/entitlements`, {
          body: { organizationIds },
        }),
      onSuccess: refresh,
    }),
  };
}
export type LlmMutations = ReturnType<typeof useLlmMutations>;
