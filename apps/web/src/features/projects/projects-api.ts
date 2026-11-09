import {
  type CreatePage,
  type CreateProject,
  pageSchema,
  type Project,
  projectSchema,
  type ProjectStatus,
  type UpdatePage,
  type UpdateProject,
} from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

/** Keyed by team so switching teams never shows another team's projects. */
const keys = {
  all: (teamId: string) => ['projects', teamId] as const,
  list: (teamId: string, status: ProjectStatus) => ['projects', teamId, 'list', status] as const,
  project: (teamId: string, id: string) => ['projects', teamId, 'project', id] as const,
  pages: (teamId: string, id: string) => ['projects', teamId, 'pages', id] as const,
};

export function useProjects(teamId: string, status: ProjectStatus) {
  return useQuery({
    queryKey: keys.list(teamId, status),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/projects?status=${status}`, z.array(projectSchema), signal),
  });
}

export function useProject(teamId: string, id: string) {
  return useQuery({
    queryKey: keys.project(teamId, id),
    queryFn: ({ signal }) => apiGet(`/api/v1/projects/${id}`, projectSchema, signal),
    retry: false,
  });
}

export function usePages(teamId: string, projectId: string) {
  return useQuery({
    queryKey: keys.pages(teamId, projectId),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/projects/${projectId}/pages`, z.array(pageSchema), signal),
    retry: false,
  });
}

export function useProjectMutations(teamId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: keys.all(teamId) });
  const put = (project: Project) => {
    client.setQueryData(keys.project(teamId, project.id), project);
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateProject) =>
        apiSend('POST', '/api/v1/projects', { body, schema: projectSchema }),
      onSuccess: async (project) => {
        put(project);
        await refresh();
      },
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: UpdateProject & { id: string }) =>
        apiSend('PATCH', `/api/v1/projects/${id}`, { body, schema: projectSchema }),
      onSuccess: async (project) => {
        put(project);
        await refresh();
      },
    }),
    /** Records the visit for "Recent projects"; failures never block opening. */
    open: useMutation({
      mutationFn: (id: string) =>
        apiSend('POST', `/api/v1/projects/${id}/open`, { schema: projectSchema }),
      onSuccess: put,
    }),
  };
}

export function usePageMutations(teamId: string, projectId: string) {
  const client = useQueryClient();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.pages(teamId, projectId) }),
      client.invalidateQueries({ queryKey: keys.project(teamId, projectId) }),
      client.invalidateQueries({ queryKey: ['projects', teamId, 'list'] }),
    ]);
  return {
    create: useMutation({
      mutationFn: (body: CreatePage) =>
        apiSend('POST', `/api/v1/projects/${projectId}/pages`, { body, schema: pageSchema }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ pageId, ...body }: UpdatePage & { pageId: string }) =>
        apiSend('PATCH', `/api/v1/projects/${projectId}/pages/${pageId}`, {
          body,
          schema: pageSchema,
        }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (pageId: string) =>
        apiSend('DELETE', `/api/v1/projects/${projectId}/pages/${pageId}`),
      onSuccess: refresh,
    }),
  };
}
