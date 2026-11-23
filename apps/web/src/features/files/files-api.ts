import {
  type CreateProject,
  deleteFolderResultSchema,
  emptyTrashResultSchema,
  type Folder,
  folderSchema,
  type Project,
  type ProjectSort,
  projectSchema,
  type ProjectStatus,
} from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

/**
 * Figma-style data (ADR-0014): UI "Projects" are folders, UI "files" are the API's projects.
 * Keys start with ['projects', teamId] so every existing project refresh also refreshes these.
 */
export const fileKeys = {
  all: (teamId: string) => ['projects', teamId] as const,
  folders: (teamId: string) => ['projects', teamId, 'folders'] as const,
  files: (teamId: string, query: FileQuery) => ['projects', teamId, 'files', query] as const,
};

export interface FileQuery {
  status: ProjectStatus;
  /** 'drafts', a folder id, or undefined for every file. */
  folder?: string | undefined;
  q?: string | undefined;
  sort: ProjectSort;
}

export const filesPath = (query: FileQuery) => {
  const params = new URLSearchParams({ status: query.status, sort: query.sort });
  if (query.folder) params.set('folder', query.folder);
  if (query.q) params.set('q', query.q);
  return `/api/v1/projects?${params.toString()}` as const;
};

export function useFolders(teamId: string) {
  return useQuery({
    queryKey: fileKeys.folders(teamId),
    queryFn: ({ signal }) => apiGet('/api/v1/folders', z.array(folderSchema), signal),
  });
}

export function useFiles(teamId: string, query: FileQuery) {
  return useQuery({
    queryKey: fileKeys.files(teamId, query),
    queryFn: ({ signal }) => apiGet(filesPath(query), z.array(projectSchema), signal),
  });
}

export function useFolderMutations(teamId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: fileKeys.all(teamId) });
  return {
    create: useMutation({
      mutationFn: (name: string) =>
        apiSend('POST', '/api/v1/folders', { body: { name }, schema: folderSchema }),
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: ({ folder, name }: { folder: Folder; name: string }) =>
        apiSend('PATCH', `/api/v1/folders/${folder.id}`, { body: { name }, schema: folderSchema }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (folder: Folder) =>
        apiSend('DELETE', `/api/v1/folders/${folder.id}`, { schema: deleteFolderResultSchema }),
      onSuccess: refresh,
    }),
  };
}

export function useFileMutations(teamId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: fileKeys.all(teamId) });
  const patch = (file: Project, body: Record<string, unknown>) =>
    apiSend('PATCH', `/api/v1/projects/${file.id}`, {
      body: { ...body, expectedUpdatedAt: file.updatedAt },
      schema: projectSchema,
    });
  return {
    create: useMutation({
      mutationFn: async ({
        input,
        designSystem,
      }: {
        input: CreateProject;
        designSystem: string;
      }) => {
        const file = await apiSend('POST', '/api/v1/projects', {
          body: input,
          schema: projectSchema,
        });
        // New files start with CORE 2.0; another team design system is copied in right away.
        if (designSystem !== 'core-2')
          await apiSend('POST', `/api/v1/projects/${file.id}/design/apply`, {
            body: { slug: designSystem },
          });
        return file;
      },
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: ({ file, name }: { file: Project; name: string }) => patch(file, { name }),
      onSuccess: refresh,
    }),
    move: useMutation({
      mutationFn: ({ file, folderId }: { file: Project; folderId: string | null }) =>
        patch(file, { folderId }),
      onSuccess: refresh,
    }),
    duplicate: useMutation({
      mutationFn: (file: Project) =>
        apiSend('POST', `/api/v1/projects/${file.id}/duplicate`, {
          body: {},
          schema: projectSchema,
        }),
      onSuccess: refresh,
    }),
    trash: useMutation({
      mutationFn: (file: Project) => patch(file, { status: 'archived' }),
      onSuccess: refresh,
    }),
    restore: useMutation({
      mutationFn: (file: Project) => patch(file, { status: 'active' }),
      onSuccess: refresh,
    }),
    /** Permanent: only for files in Trash (team admins/owners). */
    deleteForever: useMutation({
      mutationFn: (file: Project) => apiSend('DELETE', `/api/v1/projects/${file.id}`),
      onSuccess: refresh,
    }),
    emptyTrash: useMutation({
      mutationFn: () =>
        apiSend('DELETE', '/api/v1/projects/trash', { schema: emptyTrashResultSchema }),
      onSuccess: refresh,
    }),
  };
}
