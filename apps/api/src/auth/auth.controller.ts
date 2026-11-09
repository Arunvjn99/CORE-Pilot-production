import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as oidc from 'openid-client';
import type { SessionResponse } from '@core-studio/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import {
  Auth,
  type AuthContext,
  type AuthenticatedRequest,
  correlationIdOf,
} from './auth-context.js';
import {
  clearCookie,
  LOGIN_BINDING_COOKIE,
  readCookie,
  SESSION_COOKIE,
  setCookie,
} from './cookies.js';
import { Public } from './decorators.js';
import { IdentityService } from './identity.service.js';
import { OidcService } from './oidc.service.js';
import { resolvePermissions } from './permissions.js';
import { newOpaqueToken, SessionStore, sha256 } from './session.store.js';

/** Only same-app relative paths: blocks open redirects such as //evil.com or /\evil.com. */
export const returnToSchema = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\s]*$/)
  .catch('/');

class StepUpMismatchError extends Error {}

const loginQuerySchema = z.object({
  returnTo: returnToSchema.optional(),
  loginHint: z.string().max(320).optional(),
});

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidcService: OidcService,
    private readonly sessions: SessionStore,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('login')
  async login(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const { returnTo = '/', loginHint } = loginQuerySchema.parse(query);
    await this.startLogin(res, { returnTo, loginHint, stepUpSessionId: null });
  }

  /** Forces re-authentication at the IdP (prompt=login); success stamps the existing session. */
  @Get('step-up')
  async stepUp(
    @Query() query: unknown,
    @Auth() auth: AuthContext,
    @Res() res: Response,
  ): Promise<void> {
    const { returnTo = '/' } = loginQuerySchema.parse(query);
    await this.startLogin(res, { returnTo, loginHint: undefined, stepUpSessionId: auth.sessionId });
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const correlationId = correlationIdOf(req);
    const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
    const pending = state ? await this.sessions.takePendingLogin(state) : null;
    const binding = readCookie(req, LOGIN_BINDING_COOKIE);
    clearCookie(res, LOGIN_BINDING_COOKIE);

    // Login CSRF defence: the callback must arrive in the same browser that started the login.
    if (!pending || !binding || sha256(binding) !== pending.bindingHash) {
      await this.audit.security({
        eventType: 'auth.sign_in',
        outcome: 'failure',
        correlationId,
        details: { reason: 'state_mismatch' },
      });
      res.redirect(303, '/?authError=expired');
      return;
    }

    try {
      const callbackUrl = new URL(req.originalUrl, this.config.PUBLIC_APP_ORIGIN);
      const identity = await this.oidcService.completeLogin(callbackUrl, {
        state,
        nonce: pending.nonce,
        codeVerifier: pending.codeVerifier,
      });
      const user = await this.identity.upsertFromIdentity(identity);

      if (pending.stepUpSessionHash) {
        const currentId = readCookie(req, SESSION_COOKIE);
        const existing = await this.sessions.touch(currentId);
        if (
          !currentId ||
          !existing ||
          sha256(currentId) !== pending.stepUpSessionHash ||
          existing.userId !== user.id
        ) {
          throw new StepUpMismatchError('Step-up identity does not match the session');
        }
        await this.sessions.update(currentId, { ...existing, stepUpAt: Date.now() });
        await this.audit.security({
          eventType: 'auth.step_up',
          outcome: 'success',
          userId: user.id,
          correlationId,
        });
        res.redirect(303, pending.returnTo);
        return;
      }

      // Session fixation defence: always a brand-new session id; drop any previous session.
      const previousId = readCookie(req, SESSION_COOKIE);
      const previous = await this.sessions.touch(previousId);
      if (previous && previousId) await this.sessions.destroy(previousId, previous.userId);

      const teams = await this.identity.listOrganizations(user.id, false);
      const { id } = await this.sessions.create({
        userId: user.id,
        activeOrganizationId: teams[0]?.id ?? null,
        stepUpAt: null,
        idTokenHint: identity.idToken || null,
      });
      setCookie(res, SESSION_COOKIE, id, this.config.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3600);
      await this.audit.security({
        eventType: 'auth.sign_in',
        outcome: 'success',
        userId: user.id,
        correlationId,
      });
      res.redirect(303, pending.returnTo);
    } catch (error) {
      this.logger.warn({ err: error, correlationId }, 'Sign-in failed');
      await this.audit.security({
        eventType: pending.stepUpSessionHash ? 'auth.step_up' : 'auth.sign_in',
        outcome: 'failure',
        correlationId,
        details: { reason: error instanceof Error ? error.constructor.name : 'unknown' },
      });
      res.redirect(303, '/?authError=failed');
    }
  }

  @Get('session')
  async session(@Auth() auth: AuthContext): Promise<SessionResponse> {
    const organizations = await this.identity.listOrganizations(auth.userId, auth.platformAdmin);
    let active = auth.session.activeOrganizationId;
    // Keep the active team valid: users added to a team after sign-in, or removed from their active team.
    const memberOf = organizations.filter((org) => org.role !== null);
    if (!active || (!auth.platformAdmin && !memberOf.some((org) => org.id === active))) {
      active = memberOf[0]?.id ?? null;
      if (active !== auth.session.activeOrganizationId) {
        await this.sessions.update(auth.sessionId, {
          ...auth.session,
          activeOrganizationId: active,
        });
      }
    }
    // Permissions must describe the team that is actually active after the adjustment above.
    const role =
      active === auth.organizationId
        ? auth.role
        : (organizations.find((org) => org.id === active)?.role ?? null);
    const permissions = resolvePermissions(role, auth.platformAdmin);
    const recentUntil = auth.session.stepUpAt
      ? auth.session.stepUpAt + this.config.STEP_UP_MAX_AGE_MINUTES * 60_000
      : null;
    return {
      user: {
        id: auth.userId,
        displayName: auth.displayName,
        email: auth.email,
        platformAdmin: auth.platformAdmin,
      },
      organizations,
      activeOrganizationId: active,
      permissions: [...permissions].sort(),
      csrfToken: auth.session.csrfToken,
      recentAuthUntil:
        recentUntil && recentUntil > Date.now() ? new Date(recentUntil).toISOString() : null,
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.destroy(auth.sessionId, auth.userId);
    clearCookie(res, SESSION_COOKIE);
    await this.audit.security({
      eventType: 'auth.sign_out',
      outcome: 'success',
      userId: auth.userId,
      correlationId: correlationIdOf(req),
    });
    return {
      endSessionUrl: await this.oidcService
        .endSessionUrl(auth.session.idTokenHint)
        .catch(() => null),
    };
  }

  private async startLogin(
    res: Response,
    options: { returnTo: string; loginHint: string | undefined; stepUpSessionId: string | null },
  ): Promise<void> {
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const binding = newOpaqueToken();
    await this.sessions.savePendingLogin(state, {
      codeVerifier,
      nonce,
      returnTo: options.returnTo,
      bindingHash: sha256(binding),
      stepUpSessionHash: options.stepUpSessionId ? sha256(options.stepUpSessionId) : null,
    });
    setCookie(res, LOGIN_BINDING_COOKIE, binding, 600);
    const url = await this.oidcService.buildAuthorizationUrl({
      state,
      nonce,
      codeVerifier,
      forceReauthentication: options.stepUpSessionId !== null,
      ...(options.loginHint ? { loginHint: options.loginHint } : {}),
    });
    res.redirect(303, url.href);
  }
}
