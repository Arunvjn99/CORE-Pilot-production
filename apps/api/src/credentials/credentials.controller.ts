import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCredentialSchema,
  createPlatformCredentialSchema,
  credentialPolicySchema,
  entitlementsSchema,
  rotateCredentialSchema,
} from '@core-studio/contracts';
import type { z } from 'zod';
import {
  Auth,
  type AuthContext,
  type AuthenticatedRequest,
  correlationIdOf,
} from '../auth/auth-context.js';
import { RequirePermission, RequireRecentAuth } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CredentialsService } from './credentials.service.js';

/** Team and personal credentials. Every mutation requires a recent re-authentication (D8). */
@ApiTags('llm-credentials')
@Controller({ path: 'llm', version: '1' })
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get('credentials')
  @RequirePermission('providers:read')
  list(@Auth() auth: AuthContext) {
    return this.credentials.list(auth);
  }

  @Post('credentials')
  @RequireRecentAuth()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createCredentialSchema)) body: z.infer<typeof createCredentialSchema>,
  ) {
    return this.credentials.create(auth, body, correlationIdOf(req));
  }

  @Post('credentials/:id/rotate')
  @HttpCode(204)
  @RequireRecentAuth()
  async rotate(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rotateCredentialSchema)) body: z.infer<typeof rotateCredentialSchema>,
  ) {
    await this.credentials.rotate(auth, id, body.secret, correlationIdOf(req));
  }

  @Delete('credentials/:id')
  @HttpCode(204)
  @RequireRecentAuth()
  async revoke(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.credentials.revoke(auth, id, correlationIdOf(req));
  }

  @Get('policy')
  @RequirePermission('providers:read')
  policy(@Auth() auth: AuthContext) {
    return this.credentials.getPolicy(auth);
  }

  @Put('policy')
  @HttpCode(204)
  @RequirePermission('providers:manage')
  @RequireRecentAuth()
  async setPolicy(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(credentialPolicySchema)) body: z.infer<typeof credentialPolicySchema>,
  ) {
    await this.credentials.setPolicy(auth, body, correlationIdOf(req));
  }
}

/** Company-managed credentials (D4): company admins only; teams are entitled individually. */
@ApiTags('platform-llm-credentials')
@Controller({ path: 'platform/llm-credentials', version: '1' })
@RequirePermission('platform-credentials:manage')
export class PlatformCredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.credentials.listPlatform(auth);
  }

  @Post()
  @RequireRecentAuth()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createPlatformCredentialSchema))
    body: z.infer<typeof createPlatformCredentialSchema>,
  ) {
    return this.credentials.createPlatform(auth, body, correlationIdOf(req));
  }

  @Post(':id/rotate')
  @HttpCode(204)
  @RequireRecentAuth()
  async rotate(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rotateCredentialSchema)) body: z.infer<typeof rotateCredentialSchema>,
  ) {
    await this.credentials.rotatePlatform(auth, id, body.secret, correlationIdOf(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireRecentAuth()
  async revoke(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.credentials.revokePlatform(auth, id, correlationIdOf(req));
  }

  @Put(':id/entitlements')
  @HttpCode(204)
  @RequireRecentAuth()
  async entitlements(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(entitlementsSchema)) body: z.infer<typeof entitlementsSchema>,
  ) {
    await this.credentials.setEntitlements(auth, id, body.organizationIds, correlationIdOf(req));
  }
}
