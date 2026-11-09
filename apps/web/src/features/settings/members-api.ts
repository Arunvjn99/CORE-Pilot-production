import { directoryUserSchema, type MembershipRole, memberSchema } from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

export const ROLE_LABELS: Record<MembershipRole, string> = {
  org_owner: 'Owner',
  org_admin: 'Admin',
  designer: 'Designer',
  viewer: 'Viewer',
};

const membersKey = (teamId: string) => ['teams', teamId, 'members'] as const;

export function useMembers(teamId: string) {
  return useQuery({
    queryKey: membersKey(teamId),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/orgs/${teamId}/members`, z.array(memberSchema), signal),
  });
}

export function useDirectorySearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['directory', q],
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/directory/users?q=${encodeURIComponent(q)}`,
        z.array(directoryUserSchema),
        signal,
      ),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

export function useMemberMutations(teamId: string) {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: membersKey(teamId) });
  return {
    add: useMutation({
      mutationFn: (input: { userId: string; role: MembershipRole }) =>
        apiSend('POST', `/api/v1/orgs/${teamId}/members`, { body: input }),
      onSuccess: invalidate,
    }),
    changeRole: useMutation({
      mutationFn: (input: { userId: string; role: MembershipRole }) =>
        apiSend('PATCH', `/api/v1/orgs/${teamId}/members/${input.userId}`, {
          body: { role: input.role },
        }),
      onSettled: invalidate,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => apiSend('DELETE', `/api/v1/orgs/${teamId}/members/${userId}`),
      onSettled: invalidate,
    }),
  };
}
