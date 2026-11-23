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
  createKnowledgeDocumentSchema,
  updateKnowledgeDocumentSchema,
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
import { KnowledgeService } from './knowledge.service.js';

/**
 * Team knowledge base. Every member reads it (it shapes their runs); writing is a team-admin
 * action (`design-systems:manage`, admins and owners) because every agent of every run follows it.
 */
@ApiTags('studio')
@Controller({ path: 'studio/knowledge', version: '1' })
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @RequirePermission('projects:read')
  list(@Auth() auth: AuthContext) {
    return this.knowledge.list(auth);
  }

  @Post()
  @RequirePermission('design-systems:manage')
  create(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createKnowledgeDocumentSchema))
    body: z.infer<typeof createKnowledgeDocumentSchema>,
  ) {
    return this.knowledge.create(auth, body, correlationIdOf(req));
  }

  @Put(':id')
  @RequirePermission('design-systems:manage')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateKnowledgeDocumentSchema))
    body: z.infer<typeof updateKnowledgeDocumentSchema>,
  ) {
    return this.knowledge.update(auth, id, body, correlationIdOf(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('design-systems:manage')
  async remove(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.knowledge.remove(auth, id, correlationIdOf(req));
  }
}
