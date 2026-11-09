import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@core-studio/contracts';

export const PUBLIC_ROUTE = 'auth:public';
export const REQUIRED_PERMISSIONS = 'auth:permissions';
export const REQUIRES_RECENT_AUTH = 'auth:recent';
export const SKIP_CSRF = 'auth:skip-csrf';

/** Route needs no session (health, login, callback). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
/** Every listed permission is required on the target team (or company-wide). */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
/** Requires a forced re-authentication within STEP_UP_MAX_AGE_MINUTES (credential changes). */
export const RequireRecentAuth = () => SetMetadata(REQUIRES_RECENT_AUTH, true);
