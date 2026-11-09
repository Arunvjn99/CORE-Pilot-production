import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { MembershipRole, Permission } from '@core-studio/contracts';
import type { Request } from 'express';
import type { StoredSession } from './session.types.js';

/** Resolved per request by SessionGuard from the session plus fresh DB state. */
export interface AuthContext {
  sessionId: string;
  session: StoredSession;
  userId: string;
  displayName: string;
  email: string | null;
  platformAdmin: boolean;
  /** Team the request acts on (route :orgId if present, else the session's active team). */
  organizationId: string | null;
  role: MembershipRole | null;
  permissions: Set<Permission>;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext; id?: unknown };

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error('Auth context missing: route is not protected by SessionGuard');
  return auth;
});

export function correlationIdOf(req: AuthenticatedRequest): string {
  return typeof req.id === 'string' ? req.id : 'unknown';
}
