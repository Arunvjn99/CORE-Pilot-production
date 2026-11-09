import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { RepositoriesService } from '../repositories/repositories.service.js';
import { ProjectsService } from './projects.service.js';

@Module({ controllers: [ProjectsController], providers: [ProjectsService, RepositoriesService] })
export class ProjectsModule {}
