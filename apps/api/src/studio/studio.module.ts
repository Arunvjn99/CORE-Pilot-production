import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { RepositoriesService } from '../repositories/repositories.service.js';
import { LibraryService } from './library.service.js';
import { MetricsService } from './metrics.service.js';
import { RunsService } from './runs.service.js';
import { StudioController } from './studio.controller.js';
import { StudioService } from './studio.service.js';

@Module({
  imports: [AuthModule, CredentialsModule],
  controllers: [StudioController],
  providers: [LibraryService, StudioService, RunsService, MetricsService, RepositoriesService],
})
export class StudioModule {}
