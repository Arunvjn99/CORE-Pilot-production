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
  commentListQuerySchema,
  createCommentSchema,
  createReplySchema,
  updateCommentSchema,
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
import { CommentsService } from './comments.service.js';

/**
 * Comments on a file. Reading needs projects:read; commenting projects:write. Editing is for the
 * author only; deleting for the author or a team admin/owner (checked in the service).
 */
@ApiTags('comments')
@Controller({ path: 'projects/:id/comments', version: '1' })
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @RequirePermission('projects:read')
  list(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(commentListQuerySchema)) query: z.infer<typeof commentListQuerySchema>,
  ) {
    return this.comments.list(auth, id, query.includeResolved);
  }

  @Post()
  @RequirePermission('projects:write')
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createCommentSchema)) body: z.infer<typeof createCommentSchema>,
  ) {
    return this.comments.create(auth, id, body, correlationIdOf(req));
  }

  @Post(':commentId/replies')
  @RequirePermission('projects:write')
  reply(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body(new ZodPipe(createReplySchema)) body: z.infer<typeof createReplySchema>,
  ) {
    return this.comments.reply(auth, id, commentId, body.body, correlationIdOf(req));
  }

  @Patch(':commentId')
  @RequirePermission('projects:write')
  edit(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body(new ZodPipe(updateCommentSchema)) body: z.infer<typeof updateCommentSchema>,
  ) {
    return this.comments.edit(auth, id, commentId, body.body, correlationIdOf(req));
  }

  @Post(':commentId/resolve')
  @HttpCode(200)
  @RequirePermission('projects:write')
  resolve(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.setResolved(auth, id, commentId, true, correlationIdOf(req));
  }

  @Post(':commentId/reopen')
  @HttpCode(200)
  @RequirePermission('projects:write')
  reopen(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.setResolved(auth, id, commentId, false, correlationIdOf(req));
  }

  @Delete(':commentId')
  @HttpCode(204)
  @RequirePermission('projects:write')
  async remove(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.comments.remove(auth, id, commentId, correlationIdOf(req));
  }
}
