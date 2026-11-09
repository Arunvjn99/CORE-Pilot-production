import type { MembershipRole, Permission } from '@core-studio/contracts';

const VIEWER: readonly Permission[] = [
  'members:read',
  'projects:read',
  'providers:read',
  'usage:read:self',
];
const DESIGNER: readonly Permission[] = [
  ...VIEWER,
  'projects:write',
  'canvas:edit',
  'credentials:personal',
];
const ADMIN: readonly Permission[] = [
  ...DESIGNER,
  'members:manage',
  'providers:manage',
  'design-systems:manage',
  'usage:read:team',
];
const OWNER: readonly Permission[] = [...ADMIN, 'org:manage'];

export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly Permission[]>> = {
  viewer: VIEWER,
  designer: DESIGNER,
  org_admin: ADMIN,
  org_owner: OWNER,
};

/** Company-wide permissions. Company admins may also administer any team (bootstrap/support). */
export const PLATFORM_ADMIN_PERMISSIONS: readonly Permission[] = [
  'orgs:create',
  'orgs:read-all',
  'platform-credentials:manage',
  'usage:read:all',
  'members:read',
  'members:manage',
  'org:manage',
];

export function resolvePermissions(
  role: MembershipRole | null,
  platformAdmin: boolean,
): Set<Permission> {
  const permissions = new Set<Permission>(role ? ROLE_PERMISSIONS[role] : []);
  if (platformAdmin)
    for (const permission of PLATFORM_ADMIN_PERMISSIONS) permissions.add(permission);
  return permissions;
}

/** Only owners (or company admins) may grant, change or remove the owner role. */
export function canAssignRole(
  actorRole: MembershipRole | null,
  platformAdmin: boolean,
  target: MembershipRole,
): boolean {
  if (platformAdmin) return true;
  if (target === 'org_owner') return actorRole === 'org_owner';
  return actorRole === 'org_owner' || actorRole === 'org_admin';
}
