import {
  type CreateKnowledgeDocument,
  knowledgeDocumentSchema,
  type UpdateKnowledgeDocument,
} from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

export const knowledgeKeys = {
  list: (teamId: string) => ['studio', 'knowledge', teamId] as const,
};

export function useKnowledge(teamId: string) {
  return useQuery({
    queryKey: knowledgeKeys.list(teamId),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/studio/knowledge', z.array(knowledgeDocumentSchema), signal),
  });
}

export function useKnowledgeMutations(teamId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: knowledgeKeys.list(teamId) });
  return {
    create: useMutation({
      mutationFn: (body: CreateKnowledgeDocument) =>
        apiSend('POST', '/api/v1/studio/knowledge', { body, schema: knowledgeDocumentSchema }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: UpdateKnowledgeDocument & { id: string }) =>
        apiSend('PUT', `/api/v1/studio/knowledge/${id}`, { body, schema: knowledgeDocumentSchema }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiSend('DELETE', `/api/v1/studio/knowledge/${id}`),
      onSuccess: refresh,
    }),
  };
}
