import { commentThreadSchema, type createCommentSchema } from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

export const commentKeys = {
  list: (projectId: string, includeResolved: boolean) =>
    ['studio', 'comments', projectId, includeResolved] as const,
  all: (projectId: string) => ['studio', 'comments', projectId] as const,
};

export function useComments(projectId: string, includeResolved: boolean) {
  return useQuery({
    queryKey: commentKeys.list(projectId, includeResolved),
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/projects/${projectId}/comments?includeResolved=${String(includeResolved)}`,
        z.array(commentThreadSchema),
        signal,
      ),
  });
}

export function useCommentMutations(projectId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: commentKeys.all(projectId) });
  const base = `/api/v1/projects/${projectId}/comments` as const;
  return {
    create: useMutation({
      mutationFn: (body: z.input<typeof createCommentSchema>) =>
        apiSend('POST', base, { body, schema: commentThreadSchema }),
      onSuccess: refresh,
    }),
    reply: useMutation({
      mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
        apiSend('POST', `${base}/${threadId}/replies`, {
          body: { body },
          schema: commentThreadSchema,
        }),
      onSuccess: refresh,
    }),
    edit: useMutation({
      mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
        apiSend('PATCH', `${base}/${commentId}`, { body: { body }, schema: commentThreadSchema }),
      onSuccess: refresh,
    }),
    setResolved: useMutation({
      mutationFn: ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
        apiSend('POST', `${base}/${threadId}/${resolved ? 'resolve' : 'reopen'}`, {
          schema: commentThreadSchema,
        }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (commentId: string) => apiSend('DELETE', `${base}/${commentId}`),
      onSuccess: refresh,
    }),
  };
}
