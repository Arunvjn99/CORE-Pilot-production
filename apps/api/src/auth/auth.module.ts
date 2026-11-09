import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { CsrfGuard, PermissionGuard, RecentAuthGuard, SessionGuard } from './guards.js';
import { IdentityService } from './identity.service.js';
import { OidcService } from './oidc.service.js';
import { SessionStore } from './session.store.js';

/** Guard order matters: session → CSRF → permissions → step-up. Deny by default. */
@Module({
  controllers: [AuthController],
  providers: [
    OidcService,
    SessionStore,
    IdentityService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: RecentAuthGuard },
  ],
  exports: [SessionStore, IdentityService],
})
export class AuthModule {}
