import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  agentKeySchema,
  applyDesignSystemSchema,
  createDesignSystemSchema,
  designSystemSlugSchema,
  metricsQuerySchema,
  revertAgentSchema,
  sourceEditSchema,
  startRunSchema,
  type StudioConfig,
  updateAgentSchema,
  updateDesignSystemSchema,
  updateProjectDesignSchema,
  writeScreenSourceSchema,
} from '@core-studio/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  Auth,
  type AuthContext,
  type AuthenticatedRequest,
  correlationIdOf,
} from '../auth/auth-context.js';
import { RequirePermission } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { LibraryService } from './library.service.js';
import { MetricsService } from './metrics.service.js';
import { RunsService } from './runs.service.js';
import { StudioService } from './studio.service.js';

const keyPipe = new ZodPipe(agentKeySchema);
const slugPipe = new ZodPipe(designSystemSlugSchema);

/**
 * Studio v2 endpoints. Permissions use the existing model (read = projects:read / providers:read,
 * write = projects:write); everyone in a team has them for now (decision R8).
 */
@ApiTags('studio')
@Controller({ version: '1' })
export class StudioController {
  private readonly logger = new Logger(StudioController.name);

  constructor(
    private readonly library: LibraryService,
    private readonly studio: StudioService,
    private readonly runs: RunsService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('studio/config')
  @RequirePermission('projects:read')
  studioConfig(): StudioConfig {
    return {
      previewOrigin: this.config.PREVIEW_ORIGIN,
      langsmithEnabled: this.config.LANGSMITH_TRACING,
    };
  }

  // ---------- agents ----------

  @Get('studio/agents')
  @RequirePermission('projects:read')
  agents(@Auth() auth: AuthContext) {
    return this.library.listAgents(auth);
  }

  @Get('studio/agents/:key/versions')
  @RequirePermission('projects:read')
  agentVersions(
    @Auth() auth: AuthContext,
    @Param('key', keyPipe) key: z.infer<typeof agentKeySchema>,
  ) {
    return this.library.agentVersions(auth, key);
  }

  @Put('studio/agents/:key')
  @RequirePermission('projects:write')
  async updateAgent(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('key', keyPipe) key: z.infer<typeof agentKeySchema>,
    @Body(new ZodPipe(updateAgentSchema)) body: z.infer<typeof updateAgentSchema>,
  ) {
    await this.library.updateAgent(auth, key, body, correlationIdOf(req));
    return (await this.library.listAgents(auth)).find((a) => a.key === key);
  }

  @Post('studio/agents/:key/revert')
  @HttpCode(200)
  @RequirePermission('projects:write')
  async revertAgent(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('key', keyPipe) key: z.infer<typeof agentKeySchema>,
    @Body(new ZodPipe(revertAgentSchema)) body: z.infer<typeof revertAgentSchema>,
  ) {
    await this.library.revertAgent(
      auth,
      key,
      body.toVersion,
      body.expectedVersion,
      correlationIdOf(req),
    );
    return (await this.library.listAgents(auth)).find((a) => a.key === key);
  }

  // ---------- design systems ----------

  @Get('studio/design-systems')
  @RequirePermission('projects:read')
  designSystems(@Auth() auth: AuthContext) {
    return this.library.listSystems(auth);
  }

  @Post('studio/design-systems')
  @RequirePermission('projects:write')
  createDesignSystem(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(createDesignSystemSchema)) body: z.infer<typeof createDesignSystemSchema>,
  ) {
    return this.library.createSystem(auth, body, correlationIdOf(req));
  }

  @Get('studio/design-systems/:slug')
  @RequirePermission('projects:read')
  designSystem(@Auth() auth: AuthContext, @Param('slug', slugPipe) slug: string) {
    return this.library.getSystem(auth, slug);
  }

  @Get('studio/design-systems/:slug/versions')
  @RequirePermission('projects:read')
  designSystemVersions(@Auth() auth: AuthContext, @Param('slug', slugPipe) slug: string) {
    return this.library.systemVersions(auth, slug);
  }

  @Put('studio/design-systems/:slug')
  @RequirePermission('projects:write')
  updateDesignSystem(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('slug', slugPipe) slug: string,
    @Body(new ZodPipe(updateDesignSystemSchema)) body: z.infer<typeof updateDesignSystemSchema>,
  ) {
    return this.library.updateSystem(auth, slug, body, correlationIdOf(req));
  }

  // ---------- project design + screens + edits ----------

  @Get('projects/:id/design')
  @RequirePermission('projects:read')
  projectDesign(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.design(auth, id);
  }

  @Put('projects/:id/design')
  @RequirePermission('projects:write')
  updateProjectDesign(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateProjectDesignSchema)) body: z.infer<typeof updateProjectDesignSchema>,
  ) {
    return this.studio.updateDesign(auth, id, body, correlationIdOf(req));
  }

  @Post('projects/:id/design/apply')
  @HttpCode(200)
  @RequirePermission('projects:write')
  applyDesignSystem(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(applyDesignSystemSchema)) body: z.infer<typeof applyDesignSystemSchema>,
  ) {
    return this.studio.applyDesignSystem(auth, id, body.slug, correlationIdOf(req));
  }

  @Get('projects/:id/screens')
  @RequirePermission('projects:read')
  screens(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.screens(auth, id);
  }

  @Post('projects/:id/source-edits')
  @HttpCode(200)
  @RequirePermission('projects:write')
  editSource(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sourceEditSchema)) body: z.infer<typeof sourceEditSchema>,
  ) {
    return this.studio.editSource(auth, id, body, correlationIdOf(req));
  }

  /** Replaces a screen's whole source (undo/redo, code view). Returns `{ revision, code }`. */
  @Put('projects/:id/screens/:pageId/source')
  @RequirePermission('projects:write')
  writeScreenSource(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(writeScreenSourceSchema)) body: z.infer<typeof writeScreenSourceSchema>,
  ) {
    return this.studio.writeScreenSource(auth, id, pageId, body, correlationIdOf(req));
  }

  // ---------- runs ----------

  @Post('projects/:id/runs')
  @HttpCode(202)
  @RequirePermission('projects:write')
  startRun(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(startRunSchema)) body: z.infer<typeof startRunSchema>,
  ) {
    return this.runs.start(auth, id, body.prompt, correlationIdOf(req));
  }

  @Get('projects/:id/runs')
  @RequirePermission('projects:read')
  listRuns(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.list(auth, id);
  }

  @Get('projects/:id/runs/:runId')
  @RequirePermission('projects:read')
  getRun(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.runs.get(auth, id, runId);
  }

  /** Server-sent events for a run: replays from the start, then follows until the run is done. */
  @Get('projects/:id/runs/:runId/events')
  @RequirePermission('projects:read')
  async events(
    @Auth() auth: AuthContext,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<void> {
    await this.runs.assertVisible(auth, id, runId);
    // Connect before sending headers so a Redis outage is still a normal error response.
    const reader = await this.runs.openReader();
    res.status(200);
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    const connection = { closed: false };
    req.on('close', () => {
      connection.closed = true;
    });
    // Browsers resume with Last-Event-ID after a dropped connection: continue, don't replay.
    const lastEventId = req.headers['last-event-id'];
    let after =
      typeof lastEventId === 'string' && /^\d{1,20}-\d{1,20}$/.test(lastEventId)
        ? lastEventId
        : '0';
    const deadline = Date.now() + (this.config.DESIGN_RUN_TIMEOUT_SECONDS + 120) * 1000;
    try {
      while (!connection.closed && Date.now() < deadline) {
        const events = await this.runs.readEvents(reader, runId, after, 15_000);
        if (events.length === 0) {
          res.write(': keep-alive\n\n');
          continue;
        }
        let finished = false;
        for (const event of events) {
          after = event.id;
          res.write(`id: ${event.id}\ndata: ${event.data}\n\n`);
          if (event.data.includes('"type":"done"')) finished = true;
        }
        if (finished) break;
      }
    } catch (error) {
      // Headers are already sent: the error filter cannot answer any more. The client reconnects
      // (EventSource retries) or falls back to polling the run.
      this.logger.warn({ err: error, runId }, 'Run event stream interrupted');
    } finally {
      reader.disconnect();
      res.end();
    }
  }

  // ---------- metrics ----------

  @Get('studio/metrics')
  @RequirePermission('projects:read')
  getMetrics(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(metricsQuerySchema)) query: z.infer<typeof metricsQuerySchema>,
  ) {
    return this.metrics.metrics(auth, query.days);
  }
}
