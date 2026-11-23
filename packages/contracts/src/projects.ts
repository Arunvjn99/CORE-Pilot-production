import { z } from 'zod';
import { sourceEditResultSchema } from './studio.js';

const name = z.string().trim().min(1, 'Name is required').max(80);
const description = z.string().trim().max(500);
/** Optimistic concurrency token: the `updatedAt` the client last saw. */
const expectedUpdatedAt = z.iso.datetime({ offset: true });

export const projectStatusSchema = z.enum(['active', 'archived']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  status: projectStatusSchema,
  pageCount: z.number().int().min(0),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  lastOpenedAt: z.iso.datetime({ offset: true }).nullable(),
  /** UI "Project" (folder) the file is in; null = Drafts (ADR-0014). */
  folderId: z.uuid().nullable(),
  folderName: z.string().nullable(),
  designSystemSlug: z.string().nullable(),
});
/** In the UI this is a **file** (ADR-0014); the API keeps the name "project". */
export type Project = z.infer<typeof projectSchema>;

export const projectSortSchema = z.enum(['updated', 'opened', 'name', 'created']);
export type ProjectSort = z.infer<typeof projectSortSchema>;

export const projectListQuerySchema = z.object({
  status: projectStatusSchema.default('active'),
  /** `drafts` = files in no project; a folder id = that project's files; omitted = all. */
  folder: z.union([z.literal('drafts'), z.uuid()]).optional(),
  q: z.string().trim().max(80).optional(),
  sort: projectSortSchema.default('updated'),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const createProjectSchema = z.object({
  name,
  description: description.default(''),
  folderId: z.uuid().nullable().default(null),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    status: projectStatusSchema.optional(),
    /** Move to a project (folder) or to Drafts (null). */
    folderId: z.uuid().nullable().optional(),
    expectedUpdatedAt,
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.status !== undefined ||
      v.folderId !== undefined,
    { message: 'Nothing to update' },
  );
export type UpdateProject = z.infer<typeof updateProjectSchema>;

/**
 * Route paths become route files in the project repo (later slice), so they are restricted to
 * lowercase URL-safe segments. `/` is the home page.
 */
export const pageRouteSchema = z
  .string()
  .trim()
  .max(120)
  .regex(
    /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/,
    'Use lowercase letters, numbers and hyphens, e.g. /pricing or /docs/getting-started',
  );

export const pageSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  route: z.string(),
  position: z.number().int(),
  /** Source file in the project repository, e.g. src/pages/pricing/PricingPage.tsx. */
  filePath: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ProjectPage = z.infer<typeof pageSchema>;

export const createPageSchema = z.object({ name, route: pageRouteSchema });
export type CreatePage = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    name: name.optional(),
    route: pageRouteSchema.optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    expectedUpdatedAt,
  })
  .refine((v) => v.name !== undefined || v.route !== undefined || v.position !== undefined, {
    message: 'Nothing to update',
  });
export type UpdatePage = z.infer<typeof updatePageSchema>;

/** Suggests a route from a page name: "Getting Started" → "/getting-started". */
export function routeFromName(pageName: string): string {
  const slug = pageName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug ? `/${slug}` : '/';
}

export const projectRepositorySchema = z.object({
  status: z.enum(['initializing', 'ready', 'failed']),
  templateVersion: z.string(),
  workingRevision: z.number().int(),
  headCommit: z.string().nullable(),
  /** True when the working tree has changes since the last checkpoint. */
  dirty: z.boolean(),
});
export type ProjectRepository = z.infer<typeof projectRepositorySchema>;

export const checkpointSchema = z.object({
  id: z.uuid(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  message: z.string(),
  kind: z.enum(['create', 'manual', 'restore', 'safety']),
  revision: z.number().int(),
  restoredFrom: z.uuid().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export const createCheckpointSchema = z.object({
  message: z.string().trim().min(1, 'Describe the checkpoint').max(200),
});
export const restoreCheckpointSchema = z.object({
  /** Save uncommitted work as a checkpoint before restoring (default). */
  safetyCheckpoint: z.boolean().default(true),
});
/** Thumbnails for the file browser: first screen of up to 48 files in one request. */
export const MAX_THUMBNAILS = 48;
export const thumbnailQuerySchema = z.object({
  ids: z
    .string()
    .transform((v) => [...new Set(v.split(',').filter(Boolean))])
    .pipe(z.array(z.uuid()).min(1).max(MAX_THUMBNAILS)),
});
export const fileThumbnailSchema = z.object({
  id: z.uuid(),
  filePath: z.string(),
  code: z.string(),
  tokensCss: z.string(),
});
export type FileThumbnail = z.infer<typeof fileThumbnailSchema>;

/** Duplicate a file (repository and history copied). Default name: "<name> (copy)". */
export const duplicateProjectSchema = z.object({ name: name.optional() });

// ---------- folders (UI: "Projects") ----------

export const folderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Active files in this project. */
  fileCount: z.number().int().min(0),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Folder = z.infer<typeof folderSchema>;
export const createFolderSchema = z.object({ name });
export const updateFolderSchema = z.object({ name });
/** Deleting a project moves its active files to Trash. */
export const deleteFolderResultSchema = z.object({ trashedFiles: z.number().int().min(0) });

/** Export as a runnable Vite project: the current work (default) or a checkpoint. */
export const exportProjectQuerySchema = z.object({
  checkpointId: z.uuid().optional(),
});

export const checkpointListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Delete forever: everything in the team's Trash (`DELETE /projects/trash`). */
export const emptyTrashResultSchema = z.object({ deleted: z.number().int().min(0) });
export type EmptyTrashResult = z.infer<typeof emptyTrashResultSchema>;

/** Replaces a whole screen's source (undo/redo, code view). Result: `sourceEditResultSchema`. */
export const writeScreenSourceSchema = z.object({
  code: z.string().max(200_000),
  baseRevision: z.number().int().min(0),
});
export type WriteScreenSource = z.infer<typeof writeScreenSourceSchema>;
/** Same shape as a source edit's result: the new working revision and the screen's code. */
export const screenSourceResultSchema = sourceEditResultSchema;
export type ScreenSourceResult = z.infer<typeof screenSourceResultSchema>;
