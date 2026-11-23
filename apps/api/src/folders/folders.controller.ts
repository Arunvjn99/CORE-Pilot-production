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
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createFolderSchema, updateFolderSchema } from '@core-studio/contracts';
import type { z } from 'zod';
import {
  Auth,
  type AuthContext,
  type AuthenticatedRequest,
  correlationIdOf,
} from '../auth/auth-context.js';
import { RequirePermission } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { FoldersService } from './folders.service.js';

/** UI "Projects" (folders of files). Same permissions as files (decision R8). */
@ApiTags('folders')
@Controller({ path: 'folders', version: '1' })
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  @RequirePermission('projects:read')
  list(@Auth() auth: AuthContext) {
    return this.folders.list(auth);
  }

  @Post()
  @RequirePermission('projects:write')
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createFolderSchema)) body: z.infer<typeof createFolderSchema>,
  ) {
    return this.folders.create(auth, body.name, correlationIdOf(req));
  }

  @Patch(':id')
  @RequirePermission('projects:write')
  rename(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateFolderSchema)) body: z.infer<typeof updateFolderSchema>,
  ) {
    return this.folders.rename(auth, id, body.name, correlationIdOf(req));
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('projects:write')
  remove(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.folders.remove(auth, id, correlationIdOf(req));
  }
}
