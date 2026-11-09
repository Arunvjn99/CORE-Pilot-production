import { z } from 'zod';

export const CSRF_HEADER = 'x-csrf-token';

export const membershipRoleSchema = z.enum(['org_owner', 'org_admin', 'designer', 'viewer']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const permissionSchema = z.enum([
  'org:manage',
  'members:read',
  'members:manage',
  'projects:read',
  'projects:write',
  'canvas:edit',
  'providers:read',
  'providers:manage',
  'credentials:personal',
  'design-systems:manage',
  'usage:read:self',
  'usage:read:team',
  'orgs:create',
  'orgs:read-all',
  'platform-credentials:manage',
  'usage:read:all',
]);
export type Permission = z.infer<typeof permissionSchema>;

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: membershipRoleSchema.nullable(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const sessionResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.string().nullable(),
    platformAdmin: z.boolean(),
  }),
  organizations: z.array(organizationSummarySchema),
  activeOrganizationId: z.uuid().nullable(),
  permissions: z.array(permissionSchema),
  csrfToken: z.string(),
  recentAuthUntil: z.iso.datetime().nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const logoutResponseSchema = z.object({ endSessionUrl: z.url().nullable() });

export const createOrganizationSchema = z.object({ name: z.string().trim().min(2).max(100) });
export const updateOrganizationSchema = createOrganizationSchema;

export const memberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: membershipRoleSchema,
});
export type Member = z.infer<typeof memberSchema>;

export const addMemberSchema = z.object({ userId: z.uuid(), role: membershipRoleSchema });
export const updateMemberSchema = z.object({ role: membershipRoleSchema });

export const directoryQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
export const directoryUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
});
