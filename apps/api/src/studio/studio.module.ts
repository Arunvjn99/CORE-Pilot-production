import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { RepositoriesService } from '../repositories/repositories.service.js';
import { AgentTestService } from './agent-test.service.js';
import { LibraryService } from './library.service.js';
import { MetricsService } from './metrics.service.js';
import { RunsService } from './runs.service.js';
import { StudioController } from './studio.controller.js';
import { StudioService } from './studio.service.js';

@Module({
  imports: [AuthModule, CredentialsModule, KnowledgeModule],
  controllers: [StudioController],
  providers: [
    LibraryService,
    StudioService,
    RunsService,
    MetricsService,
    RepositoriesService,
    AgentTestService,
  ],
})
export class StudioModule {}
