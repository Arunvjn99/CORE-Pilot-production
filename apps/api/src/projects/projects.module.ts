import { Module } from '@nestjs/common';
import { FoldersController } from '../folders/folders.controller.js';
import { FoldersService } from '../folders/folders.service.js';
import { RepositoriesService } from '../repositories/repositories.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { TrashRetentionService } from './trash-retention.service.js';

@Module({
  controllers: [ProjectsController, FoldersController],
  providers: [ProjectsService, FoldersService, RepositoriesService, TrashRetentionService],
})
export class ProjectsModule {}
