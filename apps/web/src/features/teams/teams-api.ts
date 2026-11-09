import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiSend } from '../../lib/api-client';
import { SESSION_QUERY_KEY } from '../auth/use-session';

export function useActivateTeam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => apiSend('POST', `/api/v1/orgs/${teamId}/activate`),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useCreateTeam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const team = await apiSend('POST', '/api/v1/orgs', {
        body: { name },
        schema: z.object({ id: z.uuid(), name: z.string() }),
      });
      await apiSend('POST', `/api/v1/orgs/${team.id}/activate`);
      return team;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  });
}

export function useSignOut() {
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/auth/logout', {
        schema: z.object({ endSessionUrl: z.string().nullable() }),
      }),
    onSettled: (result) => {
      window.location.assign(result?.endSessionUrl ?? '/');
    },
  });
}
