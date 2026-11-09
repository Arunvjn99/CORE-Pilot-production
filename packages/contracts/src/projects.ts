import { z } from 'zod';

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
});
export type Project = z.infer<typeof projectSchema>;

export const projectListQuerySchema = z.object({
  status: projectStatusSchema.default('active'),
});

export const createProjectSchema = z.object({
  name,
  description: description.default(''),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    status: projectStatusSchema.optional(),
    expectedUpdatedAt,
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.status !== undefined, {
    message: 'Nothing to update',
  });
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
