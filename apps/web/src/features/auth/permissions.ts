import type { Permission, SessionResponse } from '@core-studio/contracts';
import { useSession } from './use-session';

export function hasPermission(
  session: SessionResponse | null | undefined,
  permission: Permission,
): boolean {
  return session?.permissions.includes(permission) ?? false;
}

/** UI hint only: the API enforces every permission server-side. */
export function useCan(permission: Permission): boolean {
  return hasPermission(useSession().data, permission);
}
