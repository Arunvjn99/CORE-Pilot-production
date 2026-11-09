import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, type Permission } from '@core-studio/contracts';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { isUuid } from '../db/database.js';
import type { AuthenticatedRequest } from './auth-context.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import { PUBLIC_ROUTE, REQUIRED_PERMISSIONS, REQUIRES_RECENT_AUTH } from './decorators.js';
import { IdentityService } from './identity.service.js';
import { resolvePermissions } from './permissions.js';
import { SessionStore } from './session.store.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Deny by default: every route needs a valid session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionStore,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = readCookie(req, SESSION_COOKIE);
    const session = await this.sessions.touch(sessionId);
    if (!session || !sessionId) throw new UnauthorizedException('Authentication required');

    const routeOrg = req.params['orgId'];
    if (routeOrg !== undefined && !isUuid(routeOrg)) throw new ForbiddenException('Invalid team');
    const organizationId = routeOrg ?? session.activeOrganizationId;
    const state = await this.identity.loadUserAndRole(session.userId, organizationId);
    if (!state) {
      await this.sessions.destroy(sessionId, session.userId);
      throw new UnauthorizedException('Authentication required');
    }
    req.auth = {
      sessionId,
      session,
      userId: state.user.id,
      displayName: state.user.displayName,
      email: state.user.email,
      platformAdmin: state.user.platformAdmin,
      organizationId,
      role: state.role,
      permissions: resolvePermissions(state.role, state.user.platformAdmin),
    };
    return true;
  }
}

/** Synchronizer token + Origin check on every state-changing request with a session. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!UNSAFE_METHODS.has(req.method)) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (req.headers.origin !== this.config.PUBLIC_APP_ORIGIN)
      throw new ForbiddenException('Cross-origin request rejected');
    const provided = req.headers[CSRF_HEADER];
    const expected = req.auth?.session.csrfToken;
    if (typeof provided !== 'string' || !expected)
      throw new ForbiddenException('CSRF token missing');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new ForbiddenException('CSRF token invalid');
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth || !required.every((permission) => auth.permissions.has(permission))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}

/** Step-up: sensitive operations require a forced re-authentication within the configured window. */
@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      !this.reflector.getAllAndOverride<boolean>(REQUIRES_RECENT_AUTH, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    const stepUpAt = auth?.session.stepUpAt ?? null;
    if (stepUpAt === null || Date.now() - stepUpAt > this.config.STEP_UP_MAX_AGE_MINUTES * 60_000) {
      throw new ForbiddenException({ message: 'Recent sign-in required', code: 'REAUTH_REQUIRED' });
    }
    return true;
  }
}
