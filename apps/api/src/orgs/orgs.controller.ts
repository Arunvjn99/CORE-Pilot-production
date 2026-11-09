import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addMemberSchema,
  createOrganizationSchema,
  directoryQuerySchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@core-studio/contracts';
import type { z } from 'zod';
import {
  Auth,
  type AuthContext,
  type AuthenticatedRequest,
  correlationIdOf,
} from '../auth/auth-context.js';
import { RequirePermission } from '../auth/decorators.js';
import { IdentityService } from '../auth/identity.service.js';
import { SessionStore } from '../auth/session.store.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { OrgsService } from './orgs.service.js';

@ApiTags('organizations')
@Controller({ version: '1' })
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly identity: IdentityService,
    private readonly sessions: SessionStore,
  ) {}

  @Get('orgs')
  list(@Auth() auth: AuthContext) {
    return this.identity.listOrganizations(auth.userId, auth.platformAdmin);
  }

  @Post('orgs')
  @RequirePermission('orgs:create')
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createOrganizationSchema)) body: z.infer<typeof createOrganizationSchema>,
  ) {
    return this.orgs.create(auth, body.name, correlationIdOf(req));
  }

  @Patch('orgs/:orgId')
  @HttpCode(204)
  @RequirePermission('org:manage')
  async rename(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodPipe(updateOrganizationSchema)) body: z.infer<typeof updateOrganizationSchema>,
  ) {
    await this.orgs.rename(auth, orgId, body.name, correlationIdOf(req));
  }

  /** Switches the session's active team; requires membership (or company admin). */
  @Post('orgs/:orgId/activate')
  @HttpCode(204)
  async activate(@Auth() auth: AuthContext, @Param('orgId', ParseUUIDPipe) orgId: string) {
    if (!auth.role && !auth.platformAdmin)
      throw new ForbiddenException('Not a member of this team');
    await this.sessions.update(auth.sessionId, { ...auth.session, activeOrganizationId: orgId });
  }

  @Get('orgs/:orgId/members')
  @RequirePermission('members:read')
  members(@Auth() auth: AuthContext, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgs.listMembers(auth, orgId);
  }

  @Post('orgs/:orgId/members')
  @HttpCode(204)
  @RequirePermission('members:manage')
  async addMember(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodPipe(addMemberSchema)) body: z.infer<typeof addMemberSchema>,
  ) {
    await this.orgs.addMember(auth, orgId, body.userId, body.role, correlationIdOf(req));
  }

  @Patch('orgs/:orgId/members/:userId')
  @HttpCode(204)
  @RequirePermission('members:manage')
  async changeRole(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>,
  ) {
    await this.orgs.changeRole(auth, orgId, userId, body.role, correlationIdOf(req));
  }

  @Delete('orgs/:orgId/members/:userId')
  @HttpCode(204)
  @RequirePermission('members:manage')
  async removeMember(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.orgs.removeMember(auth, orgId, userId, correlationIdOf(req));
  }

  @Get('directory/users')
  @RequirePermission('members:manage')
  directory(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(directoryQuerySchema)) query: z.infer<typeof directoryQuerySchema>,
  ) {
    return this.orgs.searchDirectory(auth, query.q);
  }
}
