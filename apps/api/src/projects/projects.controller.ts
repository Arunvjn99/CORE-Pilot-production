import {
  Body,
  Controller,
  Delete,
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
  createPageSchema,
  createProjectSchema,
  projectListQuerySchema,
  updatePageSchema,
  updateProjectSchema,
} from '@core-studio/contracts';
import type { z } from 'zod';
import {
  Auth,
  type AuthContext,
  type AuthenticatedRequest,
  correlationIdOf,
} from '../auth/auth-context.js';
import { RequirePermission } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ProjectsService } from './projects.service.js';

/** Projects and pages of the active team. Writes need projects:write; reads projects:read. */
@ApiTags('projects')
@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('projects:read')
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(projectListQuerySchema)) query: z.infer<typeof projectListQuerySchema>,
  ) {
    return this.projects.list(auth, query.status);
  }

  @Post()
  @RequirePermission('projects:write')
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createProjectSchema)) body: z.infer<typeof createProjectSchema>,
  ) {
    return this.projects.create(auth, body, correlationIdOf(req));
  }

  @Get(':id')
  @RequirePermission('projects:read')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(auth, id);
  }

  /** Marks the project as opened by the current user (recent projects). */
  @Post(':id/open')
  @HttpCode(200)
  @RequirePermission('projects:read')
  open(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.open(auth, id);
  }

  @Patch(':id')
  @RequirePermission('projects:write')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateProjectSchema)) body: z.infer<typeof updateProjectSchema>,
  ) {
    return this.projects.update(auth, id, body, correlationIdOf(req));
  }

  @Get(':id/pages')
  @RequirePermission('projects:read')
  pages(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listPages(auth, id);
  }

  @Post(':id/pages')
  @RequirePermission('projects:write')
  createPage(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createPageSchema)) body: z.infer<typeof createPageSchema>,
  ) {
    return this.projects.createPage(auth, id, body, correlationIdOf(req));
  }

  @Patch(':id/pages/:pageId')
  @RequirePermission('projects:write')
  updatePage(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(updatePageSchema)) body: z.infer<typeof updatePageSchema>,
  ) {
    return this.projects.updatePage(auth, id, pageId, body, correlationIdOf(req));
  }

  @Delete(':id/pages/:pageId')
  @HttpCode(204)
  @RequirePermission('projects:write')
  async deletePage(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
  ) {
    await this.projects.deletePage(auth, id, pageId, correlationIdOf(req));
  }
}
